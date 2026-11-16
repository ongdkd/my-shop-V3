// The sheet decides shipping: run with  node --experimental-strip-types scripts/check-sheet-ship.mjs
import assert from "node:assert/strict";
import { planSheet } from "../supabase/functions/sheets-sync/plan.ts";

const HEAD = ["ช่องทางสั่งซื้อ", "ชื่อแอคลูกค้า/รหัสออเดอร์", "ชื่อสินค้า", "จำนวน", "สถานะชำระ", "สถานะของ", "เลขพัสดุ", "หมายเหตุ", "รหัสเว็บ (ห้ามแก้)"];
const Q = "กรกฎาคม-กันยายน 2026";
const want = (web, name, product, status, extra = {}) =>
  ({ name, channel: "เว็บไซต์", product, qty: "1", pay: "100", status, tracking: "", web, open: !/จัดส่งแล้ว|ยกเลิก/.test(status), ro: false, ...extra });
const run = (rows, wants) => planSheet([{ title: Q, values: [HEAD, ...rows], isNew: false }], new Map([[Q, wants]]));
const wrote = (r, text) => r.data.some((d) => d.values[0][0] === text);

// 1. Linked row: website says ถึงไทยแล้ว, the shop typed a parcel number → website ships, sheet says จัดส่งแล้ว
let r = run([["Twitter", "@a", "Stand", "1", "Full Price", "ถึงไทยแล้ว", "WB512045731TH", "", "k:1"]], [want("1", "@a", "Stand", "ถึงไทยแล้ว")]);
assert.deepEqual(r.ships.map((s) => [s.id, s.tracking]), [["1", "WB512045731TH"]]);
assert.ok(wrote(r, "จัดส่งแล้ว") && !wrote(r, "ถึงไทยแล้ว"));

// 2. The shop typed จัดส่งแล้ว: it is no longer overwritten with the website's status
r = run([["Twitter", "@a", "Stand", "1", "Full Price", "จัดส่งแล้ว", "", "", "k:1"]], [want("1", "@a", "Stand", "ถึงไทยแล้ว")]);
assert.equal(r.ships.length, 1); assert.equal(r.data.length, 0);

// 3. Order older than the "from" date: paired by name, shipped, and the sheet is not touched
r = run([["Twitter", "@b", "Badge", "1", "Full Price", "จัดส่งแล้ว", "WB208085268TH", ""]], [want("2", "@b", "Badge", "", { ro: true })]);
assert.deepEqual(r.ships.map((s) => s.id), ["2"]); assert.equal(r.data.length, 0);
// …and with no row in the sheet it adds none
r = run([], [want("2", "@b", "Badge", "", { ro: true })]);
assert.equal(r.added, 0); assert.equal(r.data.length, 0);

// 4. Bought twice, one already shipped on the website: the open order is not paired with the shipped row
r = run([["Twitter", "@c", "Card", "1", "Full Price", "", "", ""], ["Twitter", "@c", "Card", "1", "Full Price", "จัดส่งแล้ว", "WB111111111TH", ""]],
  [want("old", "@c", "Card", "จัดส่งแล้ว", { ro: true, tracking: "WB111111111TH" }), want("new", "@c", "Card", "", { ro: true })]);
assert.equal(r.ships.length, 0);

// 5. Not shipped in the sheet, on a delivery bill, or cancelled → nothing is shipped
r = run([["Twitter", "@d", "Doll", "1", "Full Price", "ถึงไทยแล้ว", "", "", "k:4"], ["Twitter", "@e", "Doll", "1", "Full Price", "จัดส่งแล้ว", "", "", "k:5"]],
  [want("4", "@d", "Doll", "ถึงไทยแล้ว"), want("5", "@e", "Doll", "ส่งบิลแล้ว · รอโอน", { open: false })]);
assert.equal(r.ships.length, 0);

console.log("Sheet shipping checks passed.");
