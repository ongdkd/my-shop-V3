// Purchase Orders LOG: the Google Sheet is the record, the site only reads it and
// adds rows. Kept free of network calls: how to read a tab and what a new row writes.

export const PO_COLUMNS = [
  { id: "no", find: "no." },
  { id: "product", find: "product name" },
  { id: "category", find: "category" },
  { id: "supplier", find: "supplier" },
  { id: "amount", find: "amount" },
  { id: "price", find: "price (yuan)" },
  { id: "total", find: "total price" },
  { id: "picture", find: "picture" },
  { id: "orderDate", find: "order date" },
  { id: "shipDate", find: "ship date" },
  { id: "tracking", find: "tracking number" },
  { id: "status", find: "status" },
  { id: "note", find: "note" },
  { id: "rate", find: "exch. rate" },
  { id: "importFee", find: "import fee" },
  { id: "totalCost", find: "total cost" },
  { id: "costUnit", find: "cost per unit" },
  { id: "costBox", find: "cost per box" },
  { id: "saleUnit", find: "sale price (unit)" },
  { id: "saleBox", find: "sale price (box)" },
  { id: "saleShopee", find: "sale on shopee" },
  // Link to the order screenshot in Drive. Not in the sheet to begin with: added at the end the first time one is saved
  { id: "orderShot", find: "order screenshot" },
] as const;
export const PO_ORDER_SHOT_HEAD = "Order Screenshot";
export type PoField = typeof PO_COLUMNS[number]["id"];
export type PoInput = Partial<Record<PoField, string>>;

const NUMBER_FIELDS: PoField[] = ["amount", "price", "total", "rate", "importFee", "totalCost", "costUnit", "costBox", "saleUnit", "saleBox", "saleShopee"];
const DATE_FIELDS: PoField[] = ["orderDate", "shipDate"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const clean = (v: unknown) => String(v ?? "").trim().replace(/\s+/g, " ");
export const isPoTab = (title: string) => /purchase\s*orders/i.test(title);
export const poTabTitle = (year: number) => "Purchase Orders " + year;
export function colLetter(i: number) { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; }

// Column index per field, by header text; -1 when a tab doesn't have it
export function poColumns(header: unknown[]) {
  const heads = (header ?? []).map((h) => clean(h).toLowerCase());
  const col = {} as Record<PoField, number>;
  for (const c of PO_COLUMNS) col[c.id] = heads.findIndex((h) => h.startsWith(c.find));
  return col;
}

// The picture's address from =IMAGE("…"), =HYPERLINK("…") or a plain link.
// Pictures pasted into a cell have no address the Sheets API can give.
export function pictureUrl(formula: unknown) {
  const m = String(formula ?? "").match(/https:\/\/[^"'\s)]+/);
  return m ? m[0] : "";
}

// values: as shown in the sheet. formulas: the same range with formulas, for pictures.
export function parsePoTab(title: string, values: unknown[][], formulas: unknown[][]) {
  const col = poColumns(values[0] ?? []);
  const rows: Record<string, string | number>[] = [];
  if (col.product < 0) return rows;
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    if (!clean(r[col.product])) continue;
    const row: Record<string, string | number> = { tab: title, row: i + 1 };
    for (const c of PO_COLUMNS) row[c.id] = col[c.id] >= 0 ? clean(r[col[c.id]]) : "";
    row.picture = col.picture >= 0 ? pictureUrl(formulas[i]?.[col.picture]) : "";
    row.orderShot = col.orderShot >= 0 ? pictureUrl(formulas[i]?.[col.orderShot]) : "";
    rows.push(row);
  }
  return rows;
}

// "2026-10-26" → "26 Oct 2026", how the sheet writes dates
export function poDate(iso: string) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return "";
  return Number(m[3]) + " " + MONTHS[Number(m[2]) - 1] + " " + m[1];
}

// Checks the form. Text keeps a leading ' so the sheet never reads it as a formula.
export function poCells(input: PoInput) {
  const product = clean(input.product);
  if (!product) throw new Error("กรุณากรอกชื่อสินค้า");
  const cells = {} as Partial<Record<PoField, string>>;
  for (const c of PO_COLUMNS) {
    const v = clean(input[c.id]);
    if (!v || c.id === "no") continue;
    if (NUMBER_FIELDS.includes(c.id)) {
      if (!Number.isFinite(Number(v))) throw new Error(`"${c.find}" ต้องเป็นตัวเลข`);
      cells[c.id] = String(Number(v));
    } else if (DATE_FIELDS.includes(c.id)) {
      const d = poDate(v);
      if (!d) throw new Error(`"${c.find}" วันที่ไม่ถูกต้อง`);
      cells[c.id] = d;
    } else if (c.id === "picture" || c.id === "orderShot") {
      if (!/^https:\/\/[^"'\s]+$/.test(v)) throw new Error("ลิงก์รูปไม่ถูกต้อง");
      cells[c.id] = c.id === "picture" ? `=IMAGE("${v}")` : `=HYPERLINK("${v}","ภาพคำสั่งซื้อ")`;
    } else {
      cells[c.id] = "'" + v;
    }
  }
  return cells;
}

// The row after the last product, moved down past anything in the cells it would
// fill: a new row never overwrites what's there. Returns a 0-based row index.
export function poNextRow(values: unknown[][], col: Record<PoField, number>, cells: Partial<Record<PoField, string>>) {
  let i = 0;
  for (let r = 1; r < values.length; r++) if (clean(values[r]?.[col.product])) i = r;
  i++;
  const used = Object.keys(cells).map((f) => col[f as PoField]).filter((c) => c >= 0);
  while (used.some((c) => clean(values[i]?.[c]))) i++;
  return i;
}

// Changed cells of an edit. Unlike a new row, an emptied field is written, to clear it.
export function poEditCells(changes: PoInput) {
  const blanks = {} as Partial<Record<PoField, string>>;
  const filled: PoInput = {};
  for (const c of PO_COLUMNS) {
    if (c.id === "no" || !(c.id in changes)) continue;
    if (clean(changes[c.id])) filled[c.id] = changes[c.id];
    else if (c.id === "product") throw new Error("กรุณากรอกชื่อสินค้า");
    else blanks[c.id] = "";
  }
  return { ...poCells({ product: "x", ...filled }), ...blanks, ...("product" in filled ? {} : { product: undefined }) };
}

// Where an order screenshot goes in Drive: the month's folder ("November 2026"), named
// by date and product. date: the order date, else today, as YYYY-MM-DD.
export function poShotPlace(date: string, product: unknown, mime: string) {
  const [y, m] = date.split("-");
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const safe = clean(product).replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return { month: long[Number(m) - 1] + " " + y, name: date + (safe ? " " + safe : "") + "." + ext };
}

// What the sheet's Status says for a parcel at iCargo; "" before it reaches the China warehouse
export function poStatusText(trace: Record<string, unknown> | undefined) {
  return trace?.thai ? "ถึงไทยแล้ว" : trace?.outchina ? "กำลังมาไทย" : trace?.warehouse ? "ถึงโกดังจีน" : "";
}

// iCargo's steps: a date in trace.thai means it reached the Thai warehouse
export type PoParcel = { status?: unknown; statusTxt?: string; trace?: Record<string, string | null>; product?: string; checkedAt?: string; arrivedAt?: string; sheetStatus?: string };
export function poMergeParcel(old: PoParcel | undefined, found: { status?: unknown; status_txt?: string; trace?: Record<string, string | null> }, product: string, now: string) {
  const arrived = !!found.trace?.thai;
  const next: PoParcel = { status: found.status, statusTxt: found.status_txt ?? "", trace: found.trace ?? {}, product, checkedAt: now };
  next.arrivedAt = old?.arrivedAt || (arrived ? now : undefined);
  next.sheetStatus = old?.sheetStatus;
  return { parcel: next, isNew: arrived && !old?.arrivedAt };
}

// In-cell pictures: the Sheets API won't give them, but the sheet's Excel export has
// each one as a drawing anchored to its cell. files: the unzipped export.
// Returns { tab, row (1-based), col (0-based), media (path of the image file) }.
export function xlsxPictures(files: Record<string, Uint8Array>) {
  const text = (n: string) => files[n] ? new TextDecoder().decode(files[n]) : "";
  const attr = (tag: string, name: string) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) ?? [])[1] ?? "";
  const rels = (n: string) => {
    const m = new Map<string, string>();
    for (const t of text(n).match(/<Relationship\b[^>]*>/g) ?? []) m.set(attr(t, "Id"), attr(t, "Target"));
    return m;
  };
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  // "../media/image1.jpg" from xl/drawings → xl/media/image1.jpg
  const fromDir = (dir: string, target: string) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = dir.split("/");
    for (const p of target.split("/")) { if (p === "..") parts.pop(); else parts.push(p); }
    return parts.join("/");
  };
  const wbRels = rels("xl/_rels/workbook.xml.rels");
  const out: { tab: string; row: number; col: number; media: string }[] = [];
  for (const sheet of text("xl/workbook.xml").match(/<sheet\b[^>]*>/g) ?? []) {
    const path = fromDir("xl", wbRels.get(attr(sheet, "r:id")) ?? "");
    const file = path.split("/").pop();
    const sheetRels = rels(`xl/worksheets/_rels/${file}.rels`);
    for (const target of sheetRels.values()) {
      if (!/drawings\/drawing\d+\.xml$/.test(target)) continue;
      const drawing = fromDir("xl/worksheets", target);
      const name = drawing.split("/").pop();
      const media = rels(`xl/drawings/_rels/${name}.rels`);
      for (const a of text(drawing).match(/<xdr:(?:one|two)CellAnchor[\s\S]*?<\/xdr:(?:one|two)CellAnchor>/g) ?? []) {
        const col = a.match(/<xdr:col>(\d+)<\/xdr:col>/);
        const row = a.match(/<xdr:row>(\d+)<\/xdr:row>/);
        const embed = a.match(/r:embed="([^"]+)"/);
        const img = embed && media.get(embed[1]);
        if (col && row && img) out.push({ tab: unescape(attr(sheet, "name")), row: Number(row[1]) + 1, col: Number(col[1]), media: fromDir("xl/drawings", img) });
      }
    }
  }
  return out;
}
