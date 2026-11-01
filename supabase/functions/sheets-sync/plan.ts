// sheets-sync's decisions, kept free of network calls: given the sheet's tabs and
// the orders, which cells to write. Every order ends up in one of three ways:
//   - its id is already in a "รหัสเว็บ" cell → that row is kept up to date
//   - a row typed by hand has the same customer + product → the row is claimed:
//     its id goes in as "k:<id>" and the shop's wording stays
//   - neither → a new row at the end of the order's quarter tab

export const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
// Thai time (UTC+7) decides the quarter
export function quarterKey(iso: string) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  const q = Math.floor(d.getUTCMonth() / 3);
  return MONTHS[q * 3] + "-" + MONTHS[q * 3 + 2] + " " + d.getUTCFullYear();
}
// "เดือนตุลาคม-ธันวาคม 2026" and "ตุลาคม-ธันวาคม 2026" are the same quarter
export const tabKey = (title: string) => title.trim().replace(/^เดือน\s*/, "").replace(/\s+/g, " ");
// Position of a quarter in time; -1 for a tab that isn't a quarter
export function quarterIndex(key: string) {
  const m = key.match(/^(\S+?)-\S+ (\d{4})$/);
  const month = m ? MONTHS.indexOf(m[1]) : -1;
  return m && month >= 0 && month % 3 === 0 ? Number(m[2]) * 4 + month / 3 : -1;
}
export function colA1(i: number) { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }
export const quote = (t: string) => "'" + t.replace(/'/g, "''") + "'";

// Columns, found by header text like the importer; added at the end when missing
export const FIELDS = [
  { id: "name", find: ["ชื่อแอค"], head: "ชื่อแอค" },
  { id: "channel", find: ["ช่องทาง"], head: "ช่องทาง" },
  { id: "product", find: ["ชื่อสินค้า"], head: "ชื่อสินค้า" },
  { id: "qty", find: ["จำนวน"], head: "จำนวน" },
  { id: "pay", find: ["สถานะชำระ"], head: "สถานะชำระ" },
  { id: "status", find: ["สถานะของ"], head: "สถานะของ" },
  { id: "tracking", find: ["เลขพัสดุ", "หมายเหตุ"], head: "เลขพัสดุ" },
  { id: "web", find: ["รหัสเว็บ"], head: "รหัสเว็บ (ห้ามแก้)" },
] as const;
export type Field = typeof FIELDS[number]["id"];
export type Want = Record<Field, string>;
export type SheetTab = { title: string; values: string[][]; isNew: boolean };

const CLAIMED = "k:";
const TRACKING_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;
// What every unshipped order says by default: never replaces the shop's own wording
const DEFAULT_STATUS = /^(สั่งซื้อแล้ว|รอชำระเงิน)$/;
const compact = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
const matchKey = (name: unknown, product: unknown) => compact(name).replace(/^@+/, "") + "|" + compact(product);

const PREVIEW_MAX = 2000;

// tabs: every quarter tab in the sheet, plus an empty one per missing quarter.
// wants: order rows by quarter key, oldest first within a quarter, newest quarter first.
export function planSheet(tabs: SheetTab[], wants: Map<string, Want[]>) {
  const data: { range: string; values: string[][] }[] = [];
  const preview = { rows: [] as Record<string, string>[], cells: [] as Record<string, string>[], matched: [] as Record<string, string>[], headers: [] as string[],
    tabs: [] as { tab: string; orders: number; added: number; updated: number; matched: number; isNew: boolean }[] };
  let added = 0, updated = 0, matched = 0;

  const info = tabs.map((t) => {
    const head = (t.values[0] ?? []).map((h) => String(h ?? ""));
    const col = {} as Record<Field, number>;
    for (const f of FIELDS) col[f.id] = head.findIndex((h) => f.find.some((w) => h.includes(w)));
    return { ...t, key: tabKey(t.title), index: quarterIndex(tabKey(t.title)), col,
      width: Math.max(head.length, ...t.values.map((r) => r.length), 0), next: Math.max(t.values.length, 1) };
  });
  type Tab = typeof info[number];
  const tabOf = new Map(info.map((t) => [t.key, t]));
  const cell = (t: Tab, i: number, f: Field) => String(t.values[i]?.[t.col[f]] ?? "");
  const put = (t: Tab, f: Field, i: number, v: string) => data.push({ range: `${quote(t.title)}!${colA1(t.col[f])}${i + 1}`, values: [[v]] });
  function ensure(t: Tab, id: Field) {
    if (t.col[id] >= 0) return;
    const f = FIELDS.find((x) => x.id === id)!;
    t.col[id] = t.width++;
    data.push({ range: `${quote(t.title)}!${colA1(t.col[id])}1`, values: [[f.head]] });
    if (!t.isNew) preview.headers.push(`${t.title} · ${colA1(t.col[id])}1 "${f.head}"`);
  }

  // What is already there: rows with an id, and rows typed by hand
  const byId = new Map<string, { t: Tab; i: number; claimed: boolean }>();
  const hand = new Map<string, { t: Tab; i: number }[]>();
  for (const t of info) {
    let last = "";
    for (let i = 1; i < t.values.length; i++) {
      const id = t.col.web >= 0 ? cell(t, i, "web").trim() : "";
      let name = t.col.name >= 0 ? cell(t, i, "name").trim() : "";
      const product = t.col.product >= 0 ? cell(t, i, "product").trim() : "";
      // Merged name cells only fill their first row, same as the importer
      if (!name && product && t.col.channel >= 0 && !cell(t, i, "channel").trim()) name = last;
      if (name) last = name;
      if (id) { byId.set(id.replace(CLAIMED, ""), { t, i, claimed: id.startsWith(CLAIMED) }); continue; }
      if (!name || !product) continue;
      const k = matchKey(name, product);
      if (!hand.has(k)) hand.set(k, []);
      hand.get(k)!.push({ t, i });
    }
  }

  // Claim rows: the order's own tab first, across all orders, then the quarters
  // next to it (an order placed late June is often typed into the July tab)
  const claims = new Map<string, { t: Tab; i: number }>();
  const take = (want: Want, ok: (t: Tab) => boolean) => {
    if (byId.has(want.web) || claims.has(want.web)) return;
    const list = hand.get(matchKey(want.name, want.product));
    const at = list ? list.findIndex((r) => ok(r.t)) : -1;
    if (at >= 0) claims.set(want.web, list!.splice(at, 1)[0]);
  };
  for (const [k, list] of wants) for (const want of list) take(want, (t) => t.key === k);
  for (const [k, list] of wants) {
    const near = quarterIndex(k);
    for (const want of list) take(want, (t) => near >= 0 && t.index >= 0 && Math.abs(t.index - near) === 1);
  }

  // A claimed row keeps what the shop typed: only real progress on the website
  // reaches it, and a note in the tracking column is never overwritten
  function keepUpToDate(t: Tab, i: number, want: Want) {
    let changed = false;
    const was = cell(t, i, "status").trim();
    const sameMeaning = was === want.status || (/ถึงไทย/.test(was) && /ถึงไทย/.test(want.status)) || (/จัดส่งแล้ว/.test(was) && /จัดส่งแล้ว/.test(want.status));
    if (t.col.status >= 0 && !DEFAULT_STATUS.test(want.status) && !sameMeaning) {
      put(t, "status", i, want.status); changed = true;
      if (preview.cells.length < PREVIEW_MAX) preview.cells.push({ tab: t.title, row: String(i + 1), name: want.name, field: "สถานะของ", from: was, to: want.status });
    }
    const note = t.col.tracking >= 0 ? cell(t, i, "tracking").trim() : "";
    const already = (t.values[i] ?? []).some((v) => String(v ?? "").trim() === want.tracking);
    if (t.col.tracking >= 0 && want.tracking && !already && (!note || TRACKING_RE.test(note))) {
      put(t, "tracking", i, want.tracking); changed = true;
      if (preview.cells.length < PREVIEW_MAX) preview.cells.push({ tab: t.title, row: String(i + 1), name: want.name, field: "เลขพัสดุ", from: note, to: want.tracking });
    }
    return changed;
  }

  for (const [k, list] of wants) {
    const own = tabOf.get(k)!;
    const before = { added, updated, matched };
    for (const want of list) {
      const known = byId.get(want.web);
      const claim = claims.get(want.web);
      if (claim) {
        ensure(claim.t, "web");
        put(claim.t, "web", claim.i, CLAIMED + want.web);
        matched++;
        if (preview.matched.length < PREVIEW_MAX) preview.matched.push({ tab: claim.t.title, row: String(claim.i + 1), name: want.name, product: want.product });
        if (keepUpToDate(claim.t, claim.i, want)) updated++;
      } else if (known?.claimed) {
        if (keepUpToDate(known.t, known.i, want)) updated++;
      } else if (known) {
        // Only the cells that changed
        let changed = false;
        for (const f of FIELDS) ensure(known.t, f.id);
        for (const f of FIELDS) {
          const was = cell(known.t, known.i, f.id);
          if (was === want[f.id]) continue;
          put(known.t, f.id, known.i, want[f.id]);
          if (preview.cells.length < PREVIEW_MAX) preview.cells.push({ tab: known.t.title, row: String(known.i + 1), name: want.name, field: f.head, from: was, to: want[f.id] });
          changed = true;
        }
        if (changed) updated++;
      } else {
        for (const f of FIELDS) ensure(own, f.id);
        const r = own.next++;
        for (const f of FIELDS) put(own, f.id, r, want[f.id]);
        added++;
        if (preview.rows.length < PREVIEW_MAX) preview.rows.push({ tab: own.title, row: String(r + 1), ...want });
      }
    }
    preview.tabs.push({ tab: own.title, orders: list.length, added: added - before.added,
      updated: updated - before.updated, matched: matched - before.matched, isNew: own.isNew });
  }
  return { data, added, updated, matched, preview };
}
