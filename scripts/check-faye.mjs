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
console.log('check-faye: ok');
