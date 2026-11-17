// Behaviour check for Faye's lookups (js/faye-brain.js)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const F = createRequire(import.meta.url)('../js/faye-brain.js');

const panels = [{ id: 'orders', label: '📦 คำสั่งซื้อ' }, { id: 'slips', label: 'สลิป / ที่อยู่' }, { id: 'stock', label: 'คลังสินค้า' }, { id: 'products', label: 'สินค้า' }];
assert.deepEqual(F.local('ไปหน้าสลิป', panels), { do: 'goto', panel: 'slips' });
assert.deepEqual(F.local('เปิดคลังสินค้า', panels), { do: 'goto', panel: 'stock' });
assert.deepEqual(F.local('ไปหน้าสินค้า', panels), { do: 'goto', panel: 'products' });
assert.deepEqual(F.local('หา ferjmjk', panels), { do: 'find_orders', query: 'ferjmjk' });
assert.deepEqual(F.local('เพิ่มสต็อก', panels), { do: 'add_stock', item: '', qty: 0 });
assert.equal(F.local('เปิดบิลของ @zentiq', panels), null);     // not a page → the AI decides
assert.equal(F.local('วันนี้ขายได้เท่าไร', panels), null);

const O = (o) => ({ customer: '@a', product: 'p', qty: 1, total: 100, totalFull: 0, payType: 'Full Price', remark: '', status: '', shippedAt: '', timestamp: '2026-11-17T03:00:00Z', shopName: 'R1', ...o });
const orders = [
  O({ customer: '@zentiq', shippedAt: '2026-11-16T05:00:00Z' }),
  O({ customer: '@zentiQ', total: 50, totalFull: 200, payType: 'Deposit' }),
  O({ customer: '@zen', status: 'ยกเลิก' }),
  O({ customer: 'Walk in', remark: 'POS', qty: 2, total: 300 }),
  O({ customer: '@b', total: 0 }),                                  // no price
  O({ customer: '@b', total: 0, payType: 'Gift' }),                 // a gift is not "no price"
  O({ customer: '@b', timestamp: '2026-11-16T16:59:00Z', shopName: 'R2' }), // 23:59 Thai time on the 16th
  O({ customer: '@b', timestamp: '2026-11-16T17:00:00Z', shopName: 'R2' }), // 00:00 Thai time on the 17th
];

assert.equal(F.stage(orders[0]), 'จัดส่งแล้ว');
assert.equal(F.stage(orders[1]), 'รอจัดส่ง');
assert.equal(F.stage(orders[2]), 'ยกเลิก');
assert.equal(F.stage(O({ status: 'ถึงไทยแล้ว' })), 'ถึงไทยแล้ว');

// capitals and @ do not split a customer; an exact name beats longer ones
assert.equal(F.customer(orders, 'ZentiQ').rows.length, 2);
assert.deepEqual(F.customer(orders, 'zen').names, ['@zen']);
assert.equal(F.customer(orders, 'ze').names.length, 2);
assert.equal(F.customer(orders, 'ze').rows.length, 0);
assert.equal(F.customer(orders, 'nobody').names.length, 0);

const s = F.sales(orders, '2026-11-17', '2026-11-17');
assert.deepEqual(s.web, { lines: 3, qty: 3, baht: 400 });          // 100 + 200 (full price of the deposit) + 100
assert.deepEqual(s.pos, { lines: 1, qty: 2, baht: 300 });
assert.equal(s.noPrice, 1);
assert.equal(F.sales(orders, '2026-11-16', '2026-11-16').web.lines, 1);

assert.deepEqual(F.waiting(orders)[0], { round: 'R1', lines: 3, customers: 2 }); // shipped, cancelled, POS left out

const stock = [
  { name: 'Film set', stock: null, children: [{ name: 'Zayne', stock: 5, reserved: 4 }, { name: 'Caleb', stock: 9, reserved: 0 }] },
  { name: 'Badge', stock: 2, reserved: 5, children: [] },
  { name: 'Sticker', stock: null, children: [] },                   // unlimited: never "low"
];
assert.deepEqual(F.lowStock(stock).map((r) => [r.name, r.free]), [['Badge', 0], ['Film set — Zayne', 1]]);
assert.equal(F.findItems(stock, 'film zayne').length, 1);
assert.equal(F.findItems(stock, 'film').length, 2);
assert.equal(F.findItems(stock, 'film').every((r) => r.child), true);
assert.equal(F.findItems(stock, '').length, 0);
// What to buy for a round
assert.deepEqual(F.local('Shutline x mercury ต้องของอะไรบ้างและกี่ชิ้น', panels), { do: 'buy_list', item: 'Shutline x mercury' });
assert.deepEqual(F.local('รอบนี้ต้องสั่งอะไรบ้าง', panels), { do: 'buy_list', item: '' });
assert.deepEqual(F.local('รอบ Shutline ต้องซื้อกี่ชิ้น', panels), { do: 'buy_list', item: 'Shutline' });
assert.deepEqual(F.local('สรุปยอดสั่ง Shutline', panels), { do: 'buy_list', item: 'Shutline' });
const R = 'Shutline X Mercury Nov26 MD';
const B = (o) => O({ shopName: R, listId: 'L1', ...o });
const round = [
  B({ product: R + ' - ตุ๊กตาคู่', qty: 2 }), B({ product: R + ' - ตุ๊กตาคู่', qty: 3 }),
  B({ product: R + ' - ถั่ว (Jay)', qty: 3 }), B({ product: R + ' - ถั่ว (Shin:SH01)', qty: 2 }),
  B({ product: R + ' - ถั่ว (Jay)', qty: 1, status: 'ยกเลิก' }),
  B({ product: 'ของแถม: โปสการ์ด', qty: 4, payType: 'Gift' }),
  O({ shopName: 'Other', listId: 'L2', product: 'Shutline sticker', qty: 9 }),
];
const b1 = F.buyList(round, 'shutline x mercury');
assert.equal(b1.rounds.length, 1);
assert.deepEqual(b1.items.map((g) => [g.name, g.qty]), [[R + ' - ตุ๊กตาคู่', 5], [R + ' - ถั่ว', 5]]);
assert.deepEqual(b1.items[1].variants, [{ name: 'Jay', qty: 3 }, { name: 'Shin', qty: 2 }]);
assert.equal(b1.qty, 10); assert.equal(b1.giftQty, 4); assert.equal(b1.cancelled, 1);
assert.equal(F.buyList(round, '', 'L1').qty, 10);                 // the round on screen
assert.equal(F.buyList(round, 'shutline').rounds.length, 1);      // "Other" has no Shutline in its name
assert.equal(F.buyList(round, 'sticker').byProduct, true);        // no round: falls back to product names
assert.equal(F.buyList(round, 'sticker').qty, 9);

// Faye's voice (js/faye-voice.js)
const V = createRequire(import.meta.url)('../js/faye-voice.js');
for (const [kind, pool] of Object.entries(V.LINES)) {
  const lists = Array.isArray(pool) ? { '': pool } : pool;
  for (const [key, list] of Object.entries(lists)) {
    assert.ok(list.length > 0, kind + '.' + key + ' has lines');
    for (const l of list) assert.ok(typeof l === 'string' && l.trim() && l.length <= 80, kind + '.' + key + ': ' + l);
    assert.equal(new Set(list).size, list.length, kind + '.' + key + ' has no duplicates');
  }
}
for (const k of ['order', 'slip', 'remaining', 'po_arrived', 'delivered']) assert.ok(V.line('event', k));
for (const k of ['salesUp', 'salesZero', 'waitingMany', 'waitingNone', 'lowSome', 'lowNone', 'buyList']) assert.ok(V.line('quip', k));
for (const h of [0, 4, 5, 10, 11, 13, 14, 17, 18, 21, 22, 23]) { assert.ok(V.line('greet', V.part(h))); assert.ok(V.line('time', V.part(h))); }
let prev = ''; for (let i = 0; i < 30; i++) { const l = V.line('wake'); assert.notEqual(l, prev); prev = l; } // never twice in a row
assert.equal(V.line('event', 'nope'), '');
assert.deepEqual(V.tap(1), { text: V.TAPS[0][0], anim: V.TAPS[0][1] });
assert.equal(V.tap(99).text, V.TAPS[V.TAPS.length - 1][0]);       // more taps: stays at the last reaction
console.log('check-faye: ok');
