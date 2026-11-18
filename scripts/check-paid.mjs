// Behaviour check for js/paid.js: slips pay a customer's orders oldest first
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { paidOrders } = createRequire(import.meta.url)('../js/paid.js');

const O = (id, total, at, o) => ({ id, listId: 'L', customer: '@ann', total, createdAt: at, status: '', ...o });
const first = [O('a', 300, '2026-11-01T10:00Z'), O('g1', 0, '2026-11-01T10:00Z'), O('b', 200, '2026-11-01T10:00Z')];
const pay = (amount, o) => ({ listId: 'L', customer: 'ANN', amount, ...o });       // name: case and @ don't matter

assert.deepEqual(paidOrders(first, []), {});                                         // no slip: nothing paid
assert.deepEqual(Object.keys(paidOrders(first, [pay(500)])).sort(), ['a', 'b', 'g1']); // paid in full (gift line too)

// pays, then orders again: the new order is still owed
const later = first.concat([O('c', 150, '2026-11-05T09:00Z'), O('g2', 0, '2026-11-05T09:00Z')]);
const p1 = paidOrders(later, [pay(500)]);
assert.ok(p1.a && p1.b && !p1.c && !p1.g2);
const p2 = paidOrders(later, [pay(500), pay(150)]);                                  // second slip covers it
assert.ok(p2.c && p2.g2);

// cancelled lines, delivery-bill slips, POS sales and other rounds don't count
const mixed = [O('x', 100, '2026-11-01T00:00Z', { status: 'ยกเลิก' }), O('y', 100, '2026-11-02T00:00Z'),
  O('z', 50, '2026-11-02T00:00Z', { listId: 'L2' }), O('pos', 10, '2026-11-01T00:00Z', { remark: 'POS' })];
assert.deepEqual(paidOrders(mixed, [pay(100, { deliveryId: 'D1' })]), {});
assert.deepEqual(paidOrders(mixed, [pay(100)]), { y: true });
assert.deepEqual(paidOrders([O('t', 99.995, '2026-11-01T00:00Z')], [pay(99.99)]), { t: true }); // satang rounding
console.log('check-paid: ok');
