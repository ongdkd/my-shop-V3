// cloudinary — removes photos the shop no longer uses (admin only):
//   cleanup → after a delete: removes the given photo URLs from Cloudinary,
//             skipping any that something in the database still shows
//   scan    → lists photos in each Cloudinary account that nothing uses
//   delete  → removes photos picked from a scan (checked again first)
// A photo is "in use" when its URL is on an order list cover, a product or
// one of its options, or a stock item. Several Cloudinary accounts work: each
// URL names its account (res.cloudinary.com/<cloud>/…), and the keys of every
// account live in the CLOUDINARY_ACCOUNTS secret, e.g.
//   {"dk5f1v2ro":{"key":"123","secret":"abc"},"othercloud":{"key":"456","secret":"def"}}
// The browser never sees the API secrets.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Account = { key: string; secret: string };
let ACCOUNTS: Record<string, Account> = {};
try { ACCOUNTS = JSON.parse(Deno.env.get("CLOUDINARY_ACCOUNTS") || "{}"); } catch { ACCOUNTS = {}; }

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// https://res.cloudinary.com/<cloud>/image/upload/[transformations/][v123/]<public_id>.<ext>
// → "<cloud>/<public_id>", the same for every size/version of one photo
function photoKey(url: string): { cloud: string; id: string; key: string } | null {
  const m = String(url || "").match(/^https?:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/([^?#]+)/);
  if (!m) return null;
  let parts = m[2].split("/");
  const v = parts.findIndex((p) => /^v\d+$/.test(p));
  if (v !== -1) parts = parts.slice(v + 1);
  else while (parts.length > 1 && /^[a-z]{1,3}_[^/]*$/.test(parts[0])) parts.shift(); // w_300,c_fill …
  const id = parts.join("/").replace(/\.[a-z0-9]+$/i, "");
  return id ? { cloud: m[1], id, key: m[1] + "/" + id } : null;
}

async function allRows(sb: SupabaseClient, table: string, cols: string) {
  let out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`อ่าน ${table} ไม่สำเร็จ: ${error.message}`);
    out = out.concat((data ?? []) as Record<string, unknown>[]);
    if (!data || data.length < 1000) return out;
  }
}

// Every photo the database still shows. Throws rather than return a partial
// set: a missing reference would get a photo in use deleted.
async function photosInUse(sb: SupabaseClient) {
  const used = new Set<string>();
  const add = (u: unknown) => { const k = photoKey(String(u ?? "")); if (k) used.add(k.key); };
  (await allRows(sb, "order_lists", "image")).forEach((r) => add(r.image));
  (await allRows(sb, "stock_items", "image")).forEach((r) => add(r.image));
  (await allRows(sb, "products", "image,option_details")).forEach((r) => {
    add(r.image);
    const opts = Array.isArray(r.option_details) ? r.option_details as { image?: string }[] : [];
    opts.forEach((o) => add(o && o.image));
  });
  return used;
}

function auth(a: Account) { return "Basic " + btoa(a.key + ":" + a.secret); }

// Admin API: delete up to 100 public ids per request
async function destroy(cloud: string, ids: string[]) {
  const a = ACCOUNTS[cloud];
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const q = ids.slice(i, i + 100).map((id) => "public_ids[]=" + encodeURIComponent(id)).join("&");
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?${q}&invalidate=true`,
      { method: "DELETE", headers: { Authorization: auth(a) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Cloudinary (${cloud}) ${r.status}: ${j?.error?.message ?? ""}`);
    deleted += Object.values(j.deleted ?? {}).filter((s) => s === "deleted").length;
  }
  return deleted;
}

// Group photo keys by account and delete the ones not in use
async function removeUnused(sb: SupabaseClient, keys: { cloud: string; id: string; key: string }[]) {
  const used = await photosInUse(sb);
  const byCloud: Record<string, string[]> = {};
  let inUse = 0;
  const noAccount = new Set<string>();
  const seen = new Set<string>();
  for (const k of keys) {
    if (seen.has(k.key)) continue;
    seen.add(k.key);
    if (used.has(k.key)) { inUse++; continue; }
    if (!ACCOUNTS[k.cloud]) { noAccount.add(k.cloud); continue; }
    (byCloud[k.cloud] ??= []).push(k.id);
  }
  let deleted = 0;
  for (const cloud of Object.keys(byCloud)) deleted += await destroy(cloud, byCloud[cloud]);
  return { deleted, inUse, noAccount: [...noAccount] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: isAdmin } = await sb.rpc("is_admin");
  if (isAdmin !== true) return reply({ error: "Forbidden — ต้องเข้าสู่ระบบแอดมิน" }, 403);

  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* bad body */ }
  const accounts = Object.keys(ACCOUNTS);
  try {
    switch (input.action) {
      case "cleanup": {
        // Not set up yet: deleting from the shop still works, the photos just stay
        if (!accounts.length) return reply({ deleted: 0, inUse: 0, noAccount: [], notSetUp: true });
        const keys = ((input.urls ?? []) as string[]).map(photoKey).filter((k) => k !== null);
        return reply(await removeUnused(sb, keys as { cloud: string; id: string; key: string }[]));
      }

      case "scan": {
        if (!accounts.length) throw new Error("ยังไม่ได้ตั้งค่า CLOUDINARY_ACCOUNTS ใน Supabase secrets");
        const used = await photosInUse(sb);
        const unused: Record<string, unknown>[] = [];
        const totals: Record<string, { all: number; unused: number; bytes: number }> = {};
        for (const cloud of accounts) {
          const t = totals[cloud] = { all: 0, unused: 0, bytes: 0 };
          let cursor = "";
          for (let page = 0; page < 40; page++) { // up to 20,000 photos per account
            const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload?max_results=500` +
              (cursor ? "&next_cursor=" + encodeURIComponent(cursor) : ""), { headers: { Authorization: auth(ACCOUNTS[cloud]) } });
            const j = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(`Cloudinary (${cloud}) ${r.status}: ${j?.error?.message ?? ""}`);
            for (const res of (j.resources ?? []) as Record<string, unknown>[]) {
              t.all++;
              if (used.has(cloud + "/" + res.public_id)) continue;
              t.unused++; t.bytes += Number(res.bytes) || 0;
              unused.push({ cloud, id: res.public_id, url: res.secure_url, bytes: res.bytes, createdAt: res.created_at });
            }
            cursor = String(j.next_cursor ?? "");
            if (!cursor) break;
          }
        }
        return reply({ unused, totals });
      }

      case "delete": {
        const keys = ((input.items ?? []) as { cloud: string; id: string }[])
          .filter((x) => x && x.cloud && x.id).map((x) => ({ cloud: String(x.cloud), id: String(x.id), key: x.cloud + "/" + x.id }));
        return reply(await removeUnused(sb, keys));
      }

      default:
        return reply({ error: "unknown action" }, 400);
    }
  } catch (e) {
    return reply({ error: (e as Error).message });
  }
});
