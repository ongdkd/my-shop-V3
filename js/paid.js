// Which orders a customer's slips have paid for — the same rule on the status page and in
// admin (จัดการสถานะ). Slips for a round pay that customer's orders oldest first; an order
// is paid once everything ordered up to and including it is covered. So a customer who pays,
// then orders again, sees the new items still waiting for payment (a new bill), and items the
// admin adds later wait too. Delivery-bill slips (remaining + shipping) don't count here.
// Checked by scripts/check-paid.mjs.
(function (root) {
  function key(s) { return String(s || '').trim().toLowerCase().replace(/^@+/, ''); }
  function when(o) { return String(o.createdAt || o.timestamp || ''); }
  // orders: [{ id, listId, customer?, total, createdAt|timestamp, status, remark }]
  // payments: [{ listId, customer?, amount, deliveryId }]
  // → { [orderId]: true } for every paid order
  function paidOrders(orders, payments) {
    var paid = {}, money = {}, rows = {};
    (payments || []).forEach(function (p) {
      if (p.deliveryId) return;
      var k = p.listId + '|' + key(p.customer);
      money[k] = (money[k] || 0) + (Number(p.amount) || 0);
    });
    (orders || []).forEach(function (o) {
      if (o.status === 'ยกเลิก' || o.remark === 'POS') return;
      var k = o.listId + '|' + key(o.customer);
      (rows[k] = rows[k] || []).push(o);
    });
    Object.keys(rows).forEach(function (k) {
      var have = money[k] || 0, sum = 0;
      if (!have) return;
      rows[k].slice().sort(function (a, b) { return when(a).localeCompare(when(b)); }).forEach(function (o) {
        sum += Number(o.total) || 0;
        if (sum <= have + 0.01) paid[o.id] = true;
      });
    });
    return paid;
  }
  var api = { paidOrders: paidOrders };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Paid = api;
})(typeof window !== 'undefined' ? window : globalThis);
