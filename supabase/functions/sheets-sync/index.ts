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
import { unzipSync } from "npm:fflate@0.8.2";
import { colLetter, isPoTab, parsePoTab, poCells, poColumns, poEditCells, poMergeParcel, poNextRow, poTabTitle, xlsxPictures, type PoField, type PoInput, type PoParcel } from "./po.ts";

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
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly",
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

// ── Purchase Orders LOG (admin only): this sheet is the record, nothing is kept in the database ──
const PO_SHEET_ID = Deno.env.get("PO_SHEET_ID") || "1-kYU7kYBfW0ht22AFwYhUOInsUdaFDasO4zhkgSj9uY";
async function poApi() {
  const { token, email } = await googleToken();
  return (path: string, init?: RequestInit) => sheets(PO_SHEET_ID, token, email, path, init);
}
const poMeta = async (api: Awaited<ReturnType<typeof poApi>>) =>
  ((await api("?fields=sheets.properties(title,sheetId,gridProperties.rowCount)")).sheets ?? []).map((s: any) => s.properties) as
    { title: string; sheetId: number; gridProperties: { rowCount: number } }[];

// Small records kept beside the sheet: iCargo status per tracking number, uploaded pictures
async function poSetting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}
const poSave = (db: SupabaseClient, key: string, value: unknown) =>
  db.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() });

async function poList(db: SupabaseClient) {
  const api = await poApi();
  const tabs = (await poMeta(api)).filter((t) => isPoTab(t.title));
  const ranges = tabs.map((t) => "ranges=" + encodeURIComponent(quote(t.title))).join("&");
  const [shown, formulas] = tabs.length
    ? await Promise.all([api("/values:batchGet?" + ranges), api("/values:batchGet?valueRenderOption=FORMULA&" + ranges)])
    : [{}, {}];
  // Newest year's tab first, newest row first
  const rows = tabs.flatMap((t, i) => parsePoTab(t.title, shown.valueRanges?.[i]?.values ?? [], formulas.valueRanges?.[i]?.values ?? [])
    .map((r) => ({ ...r, sheetId: t.sheetId })));
  return { rows: rows.reverse(), tabs: tabs.map((t) => t.title), sheetId: PO_SHEET_ID,
    tracking: await poSetting<Record<string, PoParcel>>(db, "po_tracking", {}) };
}

// A picture the site uploaded for the sheet: the Cloudinary cleanup keeps what's listed here
async function poRememberPicture(db: SupabaseClient, url: string) {
  const known = await poSetting<Record<string, string>>(db, "po_pictures", {});
  await poSave(db, "po_pictures", { ...known, ["url:" + url]: url });
}

// Same accounts and upload preset as the site's other photos (public values, see js/config.js)
const PO_UPLOADS = [{ cloud: "dk5f1v2ro", preset: "gas_cover_img" }, { cloud: "dkjqjkc6", preset: "gas_cover_img" }];
async function poUpload(bytes: Uint8Array, name: string) {
  for (const a of PO_UPLOADS) {
    const form = new FormData();
    form.append("file", new Blob([bytes]), name);
    form.append("upload_preset", a.preset);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud}/image/upload`, { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (j.secure_url) return j.secure_url as string;
  }
  throw new Error("อัปโหลดรูปจากชีตไม่สำเร็จ");
}

// Pictures pasted into cells: taken from the sheet's Excel export. Each is uploaded once
// (remembered by its content) so the site can show it. Returns "tab|row" → address.
async function poPictures(db: SupabaseClient) {
  const { token } = await googleToken();
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${PO_SHEET_ID}/export?format=xlsx`, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) throw new Error("ดาวน์โหลดรูปจากชีตไม่ได้ (" + r.status + ")");
  const files = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const known = await poSetting<Record<string, string>>(db, "po_pictures", {});
  const pictures: Record<string, string> = {};
  let added = false;
  for (const p of xlsxPictures(files)) {
    const bytes = files[p.media];
    if (!isPoTab(p.tab) || !bytes) continue;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (!known[hash]) { known[hash] = await poUpload(bytes, p.media.split("/").pop()!); added = true; }
    pictures[p.tab + "|" + p.row] = known[hash];
  }
  if (added) await poSave(db, "po_pictures", known);
  return { pictures };
}

// One edit: the row must still hold the product the admin opened, in case rows moved in the sheet
async function poUpdate(db: SupabaseClient, input: { tab?: string; row?: number; product?: string; changes?: PoInput }) {
  const row = Number(input.row);
  if (!input.tab || !isPoTab(input.tab) || !Number.isInteger(row) || row < 2) throw new Error("ไม่พบแถวนี้");
  const cells = poEditCells(input.changes ?? {});
  const api = await poApi();
  const got = await api("/values/" + encodeURIComponent(quote(input.tab)));
  const values = (got.values ?? []) as unknown[][];
  const col = poColumns(values[0] ?? []);
  const now = String(values[row - 1]?.[col.product] ?? "").trim().replace(/\s+/g, " ");
  if (col.product < 0 || now !== String(input.product ?? "").trim().replace(/\s+/g, " ")) {
    throw new Error("แถวนี้ในชีตเปลี่ยนไปแล้ว — กดรีเฟรชแล้วลองใหม่");
  }
  const data = (Object.keys(cells) as PoField[]).filter((f) => col[f] >= 0 && cells[f] !== undefined)
    .map((f) => ({ range: `${quote(input.tab!)}!${colLetter(col[f])}${row}`, values: [[cells[f]]] }));
  if (data.length) await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
  if (input.changes?.picture) await poRememberPicture(db, input.changes.picture);
  return poList(db);
}

// ── iCargo: where each parcel is. No public API: this signs in as the shop, the same
// way portal.icargothai.com does (secrets ICARGO_USERNAME, ICARGO_PASSWORD).
const ICARGO = "https://api.icargothai.com";
const ICARGO_QUERY = `query ($search: String) { trackings(first: 5, offset: 0, type: "-2", search: $search) {
  trackings { tracking_number status status_txt trace { warehouse outchina thai payment export } } } }`;
async function icargoToken() {
  const username = Deno.env.get("ICARGO_USERNAME"), password = Deno.env.get("ICARGO_PASSWORD");
  if (!username || !password) throw new Error("ยังไม่ได้ตั้งค่า ICARGO_USERNAME / ICARGO_PASSWORD ใน Supabase secrets");
  const r = await fetch(ICARGO + "/api/v1/auth/local", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  const j = await r.json().catch(() => ({}));
  if (!j.success || !j.token) throw new Error("เข้าสู่ระบบ iCargo ไม่สำเร็จ" + (j.message ? ": " + j.message : ""));
  return j.token as string;
}

// Checks every parcel not yet in Thailand; a first arrival is stamped once, which is
// what the admin's notifications read. Numbers iCargo doesn't know yet are skipped.
async function poTrack(db: SupabaseClient) {
  const { rows } = await poList(db);
  const parcels = await poSetting<Record<string, PoParcel>>(db, "po_tracking", {});
  const todo = new Map<string, string>();
  for (const r of rows) {
    const no = String(r.tracking ?? "");
    if (no && !parcels[no]?.arrivedAt) todo.set(no, String(r.product ?? ""));
  }
  const arrived: string[] = [];
  let checked = 0;
  if (todo.size) {
    const token = await icargoToken();
    const now = new Date().toISOString();
    for (const [no, product] of todo) {
      const r = await fetch(ICARGO + "/graphql", { method: "POST",
        headers: { "Content-Type": "application/json", "x-access-token": token },
        body: JSON.stringify({ query: ICARGO_QUERY, variables: { search: no } }) });
      const j = await r.json().catch(() => ({}));
      if (j.errors?.length) throw new Error("iCargo: " + (j.errors[0].message ?? r.status));
      const list = (j.data?.trackings?.trackings ?? []) as { tracking_number?: string }[];
      const found = list.find((t) => String(t.tracking_number ?? "").trim() === no);
      checked++;
      if (!found) continue;
      const { parcel, isNew } = poMergeParcel(parcels[no], found, product, now);
      parcels[no] = parcel;
      if (isNew) arrived.push(no);
    }
    await poSave(db, "po_tracking", parcels);
  }
  return { tracking: parcels, checked, arrived };
}

// Goes in the tab of the order date's year; a new year's tab is a copy of Template
async function poAdd(db: SupabaseClient, input: PoInput) {
  const cells = poCells(input);
  const year = Number(String(input.orderDate ?? "").slice(0, 4)) || new Date(Date.now() + 7 * 3600 * 1000).getUTCFullYear();
  const api = await poApi();
  const all = await poMeta(api);
  const wanted = tabKey(poTabTitle(year));
  let tab = all.find((t) => isPoTab(t.title) && tabKey(t.title) === wanted);
  if (!tab) {
    const template = all.find((t) => /^template$/i.test(t.title.trim()));
    if (!template) throw new Error(`ไม่พบแท็บ "${wanted}" และแท็บ Template ในชีต`);
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({
      requests: [{ duplicateSheet: { sourceSheetId: template.sheetId, newSheetName: wanted } }],
    }) });
    tab = (await poMeta(api)).find((t) => t.title === wanted)!;
  }
  const got = await api("/values/" + encodeURIComponent(quote(tab.title)));
  const values = (got.values ?? []) as unknown[][];
  const col = poColumns(values[0] ?? []);
  if (col.product < 0) throw new Error(`แท็บ "${tab.title}" ไม่มีคอลัมน์ Product Name ในแถวแรก`);
  const row = poNextRow(values, col, cells);
  if (row >= tab.gridProperties.rowCount) {
    await api(":batchUpdate", { method: "POST", body: JSON.stringify({
      requests: [{ appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: 50 } }],
    }) });
  }
  const data = (Object.keys(cells) as PoField[]).filter((f) => col[f] >= 0)
    .map((f) => ({ range: `${quote(tab!.title)}!${colLetter(col[f])}${row + 1}`, values: [[cells[f]]] }));
  await api("/values:batchUpdate", { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
  if (input.picture) await poRememberPicture(db, input.picture);
  return { ...(await poList(db)), added: { tab: tab.title, row: row + 1 } };
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
  let input: { action?: string; po?: any } = {};
  try { input = await req.json(); } catch { /* sync */ }
  // The schedule may only run the iCargo check; the rest needs an admin login
  if (input.action === "po-track") {
    try { return reply(await poTrack(db)); } catch (e) { return reply({ error: (e as Error).message }); }
  }
  if (!byCron && String(input.action ?? "").startsWith("po-")) {
    try {
      if (input.action === "po-list") return reply(await poList(db));
      if (input.action === "po-add") return reply(await poAdd(db, input.po ?? {}));
      if (input.action === "po-update") return reply(await poUpdate(db, input.po ?? {}));
      if (input.action === "po-pictures") return reply(await poPictures(db));
      return reply({ error: "ไม่รู้จักคำสั่งนี้" });
    } catch (e) { return reply({ error: (e as Error).message }); }
  }
  // A request this version doesn't know must never turn into a sheet update
  if (input.action && input.action !== "sync" && input.action !== "preview") return reply({ error: "ไม่รู้จักคำสั่งนี้" });
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
