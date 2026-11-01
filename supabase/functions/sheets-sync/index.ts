// sheets-sync — writes the website's orders into the status Google Sheet:
// one row per item, in the tab of the quarter it was ordered in
// ("เดือนตุลาคม-ธันวาคม 2026"; a new quarter gets a new tab), with its current
// status and tracking number. Rows are found again by the order id in the
// "รหัสเว็บ" column, so later runs update them. A row typed by hand for the same
// customer + product is claimed instead of adding a second one (see plan.ts).
// Edits made in the sheet to rows this function added are overwritten.
//
// Called by admin (📤 in ประวัติจากชีต) or every 15 minutes by pg_cron with the
// x-sync-key header (SHEETS_SYNC_KEY). Google access is a service account
// (GOOGLE_SERVICE_ACCOUNT = its JSON key) that the sheet is shared with as editor.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { planSheet, quarterIndex, quarterKey, quote, tabKey, type Want } from "./plan.ts";

// The shop's sheet is app_settings 'sheets'.url (set by 📥 นำเข้าจากชีต); this is only the fallback
const DEFAULT_SHEET_ID = Deno.env.get("STATUS_SHEET_ID") || "1tXcsJ-qNRGLXsPCSu4srsmuibxhYZZTRrALn5BVeIx8";
const sheetIdOf = (url: unknown) => (String(url ?? "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) ?? [])[1] ?? "";
const SYNC_KEY = Deno.env.get("SHEETS_SYNC_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sync-key",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ── Google auth: service-account JWT → access token ──
function b64url(bytes: Uint8Array) {
  let s = "";
  bytes.forEach((b) => s += String.fromCharCode(b));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function googleToken() {
  let sa: { client_email?: string; private_key?: string } = {};
  try { sa = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT") || "{}"); } catch { /* checked below */ }
  if (!sa.client_email || !sa.private_key) throw new Error("ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT ใน Supabase secrets");
  const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const now = Math.floor(Date.now() / 1000);
  const unsigned = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(sig) }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google ไม่ให้สิทธิ์: " + (j.error_description || j.error || r.status));
  return { token: j.access_token as string, email: sa.client_email };
}

// email: the service account, named in the error when the sheet isn't shared with it
async function sheets(sheetId: string, token: string, email: string, path: string, init: RequestInit = {}) {
  const r = await fetch("https://sheets.googleapis.com/v4/spreadsheets/" + sheetId + path, {
    ...init, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message ?? String(r.status);
    throw new Error(r.status === 403 || r.status === 404 ? `เปิดชีตไม่ได้ — แชร์ชีตให้ ${email} เป็นผู้แก้ไข (${msg})` : "Google Sheets: " + msg);
  }
  return j;
}

async function allRows(db: SupabaseClient, table: string, cols: string, filter?: (q: any) => any) {
  let out: Record<string, any>[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select(cols).order("created_at", { ascending: true }).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    out = out.concat(data ?? []);
    if (!data || data.length < 1000) return out;
  }
}
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/^@+/, "");
const num = (v: unknown) => Number(v) || 0;

// The row the sheet shows for one order item
function rowFor(o: Record<string, any>, listPaid: boolean, bill: Record<string, any> | undefined, billPaid: boolean): Want {
  let status: string;
  if (o.status === "ยกเลิก") status = "ยกเลิก";
  else if (o.shipped_at) status = "จัดส่งแล้ว";
  else if (bill?.sent_at) status = billPaid ? "ชำระบิลแล้ว · รอจัดส่ง" : "ส่งบิลแล้ว · รอโอน";
  else if (o.status) status = o.status; // ถึงไทยแล้ว, ชำระแล้ว or a label set in admin
  else status = listPaid ? "สั่งซื้อแล้ว" : "รอชำระเงิน";
  const pay = o.pay_type === "Gift" ? "ของแถม"
    : o.pay_type === "Deposit" ? `มัดจำ ${num(o.total)} / เต็ม ${num(o.total_full)}` : String(num(o.total));
  return {
    name: String(o.customer ?? "").replace(/\s*\n\s*/g, " "), channel: "เว็บไซต์", product: String(o.product ?? ""),
    qty: String(num(o.qty)), pay, status, tracking: String(o.tracking ?? ""), web: String(o.id),
  };
}

// dry: work out every change but write nothing (no new tabs either) — the
// result lists the rows to add and the cells to change, for the admin to check
async function sync(db: SupabaseClient, dry = false) {
  const { data: setting } = await db.from("app_settings").select("value").eq("key", "sheets").maybeSingle();
  const conf = (setting?.value ?? {}) as { from?: string; url?: string };
  const since = String(conf.from ?? "");
  const sheetId = sheetIdOf(conf.url) || DEFAULT_SHEET_ID;

  const orders = await allRows(db, "orders",
    "id,customer,product,qty,pay_type,total,total_full,status,shipped_at,tracking,delivery_id,list_id,created_at",
    (q) => { q = q.neq("remark", "POS"); return since ? q.gte("created_at", since + "T00:00:00+07:00") : q; });
  const payments = await allRows(db, "payments", "list_id,customer,delivery_id,created_at");
  const bills = await allRows(db, "deliveries", "id,sent_at,created_at");
  const listPaid = new Set<string>(), billPaid = new Set<string>();
  payments.forEach((p) => p.delivery_id ? billPaid.add(p.delivery_id) : listPaid.add(p.list_id + "|" + norm(p.customer)));
  const billById = new Map(bills.map((b) => [b.id, b]));

  // Orders by quarter
  const byQuarter = new Map<string, Want[]>();
  for (const o of orders) {
    const k = quarterKey(o.created_at);
    if (!byQuarter.has(k)) byQuarter.set(k, []);
    byQuarter.get(k)!.push(rowFor(o, listPaid.has(o.list_id + "|" + norm(o.customer)), billById.get(o.delivery_id), billPaid.has(o.delivery_id)));
  }
  if (!byQuarter.size) return { added: 0, updated: 0, matched: 0, created: [] as string[], preview: { rows: [], cells: [], matched: [], headers: [] } };

  const { token, email } = await googleToken();
  const api = (path: string, init?: RequestInit) => sheets(sheetId, token, email, path, init);

  // Existing tabs; a new quarter gets its own tab
  const meta = await api("?fields=sheets.properties.title");
  const titles: string[] = (meta.sheets ?? []).map((s: any) => s.properties.title);
  const titleOf = new Map(titles.map((t) => [tabKey(t), t]));
  const created: string[] = [];
  const missing = [...byQuarter.keys()].filter((k) => !titleOf.has(k));
  if (missing.length && !dry) {
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({
      requests: missing.map((k) => ({ addSheet: { properties: { title: "เดือน" + k, gridProperties: { frozenRowCount: 1 } } } })),
    }) });
  }
  // A preview treats a missing tab as a new, empty one
  missing.forEach((k) => { titleOf.set(k, "เดือน" + k); created.push("เดือน" + k); });

  // Every quarter tab is read: a typed row can sit in the tab next to its order's
  const reading = titles.filter((t) => quarterIndex(tabKey(t)) >= 0);
  const got = reading.length
    ? await api("/values:batchGet?" + reading.map((t) => "ranges=" + encodeURIComponent(quote(t))).join("&"))
    : {};
  const tabs = reading.map((t, i) => ({ title: t, values: (got.valueRanges?.[i]?.values ?? []) as string[][], isNew: false }));
  missing.forEach((k) => tabs.push({ title: titleOf.get(k)!, values: [], isNew: true }));

  // Newest quarter first, so a long preview starts with the current orders
  const wants = new Map([...byQuarter.entries()].reverse());
  const { data, added, updated, matched, preview } = planSheet(tabs, wants);

  if (dry) return { added, updated, matched, created, orders: orders.length, sheetId, preview };
  for (let i = 0; i < data.length; i += 2000) {
    await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "RAW", data: data.slice(i, i + 2000) }) });
  }
  return { added, updated, matched, created, orders: orders.length, at: new Date().toISOString() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // The schedule sends the sync key; admins send their login
  const byCron = !!SYNC_KEY && req.headers.get("x-sync-key") === SYNC_KEY;
  if (!byCron) {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (isAdmin !== true) return reply({ error: "Forbidden — ต้องเข้าสู่ระบบแอดมิน" }, 403);
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let input: { action?: string } = {};
  try { input = await req.json(); } catch { /* sync */ }
  // A preview changes nothing, not even the "last run" record
  if (input.action === "preview" && !byCron) {
    try { return reply(await sync(db, true)); } catch (e) { return reply({ error: (e as Error).message }); }
  }
  try {
    const res = await sync(db);
    // Remembered for the admin page ("last synced …")
    await db.from("app_settings").upsert({ key: "sheets_last", value: { ...res, by: byCron ? "auto" : "admin" }, updated_at: new Date().toISOString() });
    return reply(res);
  } catch (e) {
    const error = (e as Error).message;
    await db.from("app_settings").upsert({ key: "sheets_last", value: { error, at: new Date().toISOString(), by: byCron ? "auto" : "admin" }, updated_at: new Date().toISOString() });
    return reply({ error });
  }
});
