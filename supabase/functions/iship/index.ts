// iship — iShip shipping for the admin (https://api-docs.iship.cloud):
//   couriers  → courier codes iShip can book
//   quote     → price of every courier for one delivery bill
//   create    → books the parcel: gets the tracking number, marks the bill's
//               items shipped and remembers the courier for tracking links
//   label     → the A6 shipping label (PDF)
//   trace     → tracking history of a parcel
//   pickup    → asks a courier to collect from the shop
// iShip also calls this function (…/iship?hook=<ISHIP_WEBHOOK_KEY>) with
// status updates, which are saved on the bill for the customer page.
// The iShip token stays in Supabase secrets; the browser never sees it.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const BASE = (Deno.env.get("ISHIP_BASE_URL") || "https://app.iship.cloud").replace(/\/+$/, "");
const TOKEN = Deno.env.get("ISHIP_TOKEN") ?? "";
const HOOK_KEY = Deno.env.get("ISHIP_WEBHOOK_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Parts = { name?: string; phone?: string; address?: string; district?: string; amphoe?: string; province?: string; zipcode?: string };
type Parcel = { weight?: number; width?: number; length?: number; height?: number };
type Settings = Parts & Parcel & { category_id?: number };

function call(path: string, body?: unknown): Promise<Response> {
  return fetch(BASE + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
}
// iShip answers { status: true | "success", data } or { status: false, message }
async function callJson(path: string, body?: unknown) {
  const r = await call(path, body);
  const text = await r.text();
  let j: Record<string, unknown>;
  try { j = JSON.parse(text); } catch { throw new Error(`iShip ${r.status}: ${text.slice(0, 200)}`); }
  if (!r.ok || j.status === false || j.status === "error" || j.status === "fail") {
    const msg = j.message || j.msg || (j.errors ? JSON.stringify(j.errors) : "") || `iShip ${r.status}`;
    throw new Error(String(msg));
  }
  return j;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^@+/, "");
const num = (v: unknown, d = 0) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

function need(p: Parts, who: string) {
  const miss = (["name", "phone", "address", "district", "amphoe", "province", "zipcode"] as const).filter((k) => !String(p[k] ?? "").trim());
  if (miss.length) throw new Error(`ที่อยู่${who}ไม่ครบ (${miss.join(", ")})`);
}

// Sender (shop settings), receiver (newest structured address the customer
// sent: this bill's slip first, else any of their slips) and the bill items
async function billContext(sb: SupabaseClient, deliveryId: string) {
  const { data: bill, error } = await sb.from("deliveries").select("*").eq("id", deliveryId).single();
  if (error || !bill) throw new Error("ไม่พบบิลนี้");
  const { data: items } = await sb.from("orders")
    .select("id,product,qty,price,total,total_full,pay_type,shipped_at,status").eq("delivery_id", deliveryId);
  const { data: setting } = await sb.from("app_settings").select("value").eq("key", "iship").maybeSingle();
  const { data: pays } = await sb.from("payments").select("customer,delivery_id,address_parts,created_at")
    .not("address_parts", "is", null).ilike("customer", `%${bill.customer}%`).order("created_at", { ascending: false }).limit(50);
  const mine = (pays ?? []).filter((p) => norm(p.customer) === bill.customer);
  const to = (mine.find((p) => p.delivery_id === deliveryId) ?? mine[0])?.address_parts as Parts | undefined;
  return { bill, items: items ?? [], from: (setting?.value ?? {}) as Settings, to };
}

function route(from: Parts, to: Parts) {
  return {
    src_zipcode: from.zipcode, src_province: from.province, src_amphure: from.amphoe, src_district: from.district,
    dst_zipcode: to.zipcode, dst_province: to.province, dst_amphure: to.amphoe, dst_district: to.district,
  };
}
function parcelOf(input: Parcel, from: Settings) {
  return {
    weight: num(input.weight, num(from.weight, 1)), width: num(input.width, num(from.width, 10)),
    length: num(input.length, num(from.length, 15)), height: num(input.height, num(from.height, 5)),
  };
}

// iShip's step says the parcel reached the customer → stamp delivered_at once,
// which the admin's notifications pick up. Ignores errors until the migration adds the column.
const DELIVERED_CODE = /^(delivered|complete|completed|signed|success_delivery)$/i;
const DELIVERED_TEXT = /นำจ่ายสำเร็จ|จัดส่งสำเร็จ|ส่งสำเร็จ|ผู้รับได้รับ|เซ็นรับ/;
async function markDelivered(db: SupabaseClient, tracking: string, code: string, text: string) {
  if (!DELIVERED_CODE.test(code) && !DELIVERED_TEXT.test(text)) return;
  await db.from("deliveries").update({ delivered_at: new Date().toISOString() })
    .eq("tracking", tracking).is("delivered_at", null);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);

  // ── Webhook from iShip: status of a parcel changed ──
  if (url.searchParams.has("hook")) {
    if (!HOOK_KEY || url.searchParams.get("hook") !== HOOK_KEY) return reply({ error: "forbidden" }, 403);
    let ev: Record<string, unknown> = {};
    try { ev = await req.json(); } catch { return reply({ error: "bad body" }, 400); }
    const tracking = String(ev.tracking ?? ev.track_no ?? "").trim();
    if (!tracking) return reply({ error: "no tracking" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ts = Number(ev.timestamp);
    const patch: Record<string, unknown> = {
      iship_status: String(ev.status ?? ""),
      iship_status_text: String(ev.status_desc ?? ev.status ?? ""),
      iship_status_at: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
    };
    if (Number(ev.price) > 0) patch.iship_price = Number(ev.price);
    const { error } = await admin.from("deliveries").update(patch).eq("tracking", tracking);
    if (error) return reply({ error: error.message }, 500);
    await markDelivered(admin, tracking, String(patch.iship_status), String(patch.iship_status_text));
    return reply({ ok: true });
  }

  // ── Admin actions ──
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin !== true) return reply({ error: "Forbidden — ต้องเข้าสู่ระบบแอดมิน" }, 403);
  if (!TOKEN) return reply({ error: "ยังไม่ได้ตั้งค่า ISHIP_TOKEN ใน Supabase secrets" });

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* bad body */ }
  try {
    switch (input.action) {
      case "couriers": {
        const j = await callJson("/api/courier_code");
        return reply({ couriers: j.data ?? [] });
      }

      case "quote": {
        const { from, to: saved } = await billContext(sb, String(input.deliveryId));
        const to = (input.to as Parts) ?? saved ?? {};
        need(from, "ผู้ส่ง (ตั้งค่า iShip)"); need(to, "ผู้รับ");
        const parcel = parcelOf((input.parcel ?? {}) as Parcel, from);
        const list = ((await callJson("/api/courier_code")).data ?? []) as { code: string; name: string }[];
        const prices = await Promise.all(list.map(async (c) => {
          try {
            const j = await callJson("/api/v2/check-price", { courier_code: c.code, ...route(from, to), ...parcel });
            const d = (j.data ?? j) as Record<string, unknown>;
            return { code: c.code, name: c.name, price: Number(d.total_price ?? d.price), remote: Number(d.remote_area) || 0 };
          } catch (e) {
            return { code: c.code, name: c.name, price: null, error: (e as Error).message };
          }
        }));
        prices.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
        return reply({ prices, to, parcel });
      }

      case "create": {
        const id = String(input.deliveryId);
        const { bill, items, from, to: saved } = await billContext(sb, id);
        if (bill.tracking) throw new Error(`บิลนี้สร้างเลขพัสดุแล้ว (${bill.tracking})`);
        const to = (input.to as Parts) ?? saved ?? {};
        need(from, "ผู้ส่ง (ตั้งค่า iShip)"); need(to, "ผู้รับ");
        const courier = String(input.courier || "");
        if (!courier) throw new Error("กรุณาเลือกขนส่ง");
        const parcel = parcelOf((input.parcel ?? {}) as Parcel, from);
        const j = await callJson("/api/create_order", {
          platform_name: "Order Hub",
          courier_code: courier,
          custom_order_id: id,
          src_name: from.name, src_phone: from.phone, src_address: from.address,
          src_district: from.district, src_amphure: from.amphoe, src_province: from.province, src_zipcode: from.zipcode,
          dst_name: to.name, dst_phone: to.phone, dst_address: to.address,
          dst_district: to.district, dst_amphure: to.amphoe, dst_province: to.province, dst_zipcode: to.zipcode,
          ...parcel,
          cod_amount: 0,
          category_id: Number.isInteger(from.category_id) ? from.category_id : 99,
          remark: String(input.remark ?? "").slice(0, 200),
        });
        const d = (j.data ?? {}) as Record<string, unknown>;
        const tracking = String(d.tracking_number ?? d.track_no ?? "");
        if (!tracking) throw new Error("iShip ไม่ส่งเลขพัสดุกลับมา");
        const now = new Date().toISOString();
        await sb.from("deliveries").update({
          courier, tracking, iship_ref: String(d.ref ?? ""), iship_status: "order_success",
          iship_status_text: "รอเข้ารับพัสดุ", iship_status_at: now,
        }).eq("id", id);
        // Everything still waiting in the bill goes out in this parcel
        const ship = items.filter((o) => !o.shipped_at && o.status !== "ยกเลิก").map((o) => o.id);
        if (ship.length) await sb.from("orders").update({ shipped_at: now, tracking, courier, status: "" }).in("id", ship);
        return reply({ tracking, courier, ref: d.ref ?? "", sortCode: d.sortCode ?? "", shippedAt: now, shipped: ship });
      }

      case "label": {
        const tracks = String(input.tracking ?? "").replace(/[^A-Za-z0-9,]/g, "");
        if (!tracks) throw new Error("ไม่พบเลขพัสดุ");
        const r = await call(`/api/download/pdf?tracks=${encodeURIComponent(tracks)}`);
        if (!r.ok || !(r.headers.get("content-type") ?? "").includes("pdf")) {
          throw new Error(`โหลดใบปะหน้าไม่สำเร็จ (iShip ${r.status}): ${(await r.text()).slice(0, 150)}`);
        }
        return new Response(await r.arrayBuffer(), {
          headers: { ...cors, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-${tracks}.pdf"` },
        });
      }

      case "trace": {
        const tracking = String(input.tracking ?? "");
        const j = await callJson("/api/traces", { track_no: tracking });
        const data = (j.data ?? {}) as { trace_routes?: Record<string, unknown>[] };
        // Save the newest step, so the bill's status is fresh even without the webhook
        const last = (data.trace_routes ?? []).at(-1);
        if (tracking && last) {
          const ts = Date.parse(String(last.timestamp ?? ""));
          const code = String(last.status ?? ""), text = String(last.status_text ?? last.status_desc ?? last.status ?? "");
          await sb.from("deliveries").update({
            iship_status: code, iship_status_text: text,
            iship_status_at: Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString(),
          }).eq("tracking", tracking);
          await markDelivered(sb, tracking, code, text);
        }
        return reply(data);
      }

      case "pickup": {
        const { data: setting } = await sb.from("app_settings").select("value").eq("key", "iship").maybeSingle();
        const from = (setting?.value ?? {}) as Settings;
        need(from, "ผู้ส่ง (ตั้งค่า iShip)");
        const j = await callJson("/api/request_courier", {
          courier_code: String(input.courier || ""),
          pickup_address: `${from.address} ต.${from.district} อ.${from.amphoe} จ.${from.province} ${from.zipcode}`,
          name: from.name, phone: from.phone,
          parcel: Math.max(1, Math.round(num(input.parcels, 1))),
          remark: String(input.remark ?? "").slice(0, 200),
        });
        return reply({ message: j.msg ?? j.message ?? "เรียกขนส่งเข้ารับสำเร็จ", data: j.data ?? {} });
      }

      default:
        return reply({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return reply({ error: (e as Error).message });
  }
});
