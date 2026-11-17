// Faye's lookups: plain functions over data the admin page already loads
// (orders from adminGetAllOrders, the warehouse from adminGetStockProducts).
// Nothing here talks to the server or the AI. Checked by scripts/check-faye.mjs.
(function (root) {
  // "@ZentiQ " and "zentiq" are the same customer; "LND  Set" and "lndset" the same words
  function key(s) { return String(s || '').toLowerCase().replace(/[\s@]+/g, ''); }
  // Thai calendar day (YYYY-MM-DD) of a timestamp
  function day(iso) {
    var t = new Date(iso).getTime();
    return isNaN(t) ? '' : new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function stage(o) {
    if (o.status === 'ยกเลิก') return 'ยกเลิก';
    if (o.shippedAt) return 'จัดส่งแล้ว';
    return o.status || 'รอจัดส่ง';
  }

  // Simple typed commands that need no AI. panels: [{ id, label }]. Returns an action or null.
  function local(text, panels) {
    var t = String(text || '').trim(), m;
    if ((m = t.match(/^(?:ค้นหา|หา)\s+(.+)$/))) return { do: 'find_orders', query: m[1].trim() };
    // "Shutline ต้องสั่งอะไรบ้าง", "รอบนี้ต้องซื้อกี่ชิ้น", "สรุปยอดสั่ง Shutline" → what to buy for a round
    if ((m = t.match(/^(.*?)\s*(?:ต้อง\s*(?:สั่ง\s*ซื้อ|สั่ง|ซื้อ)?\s*(?:ของ)?|สั่ง\s*ของ|ซื้อ\s*ของ)\s*(?:อะไร\s*บ้าง|กี่\s*ชิ้น|เท่า\s*(?:ไร|ไหร่))/)) ||
        (m = t.match(/^สรุป\s*(?:ยอด)?\s*(?:สั่ง\s*(?:ซื้อ)?|ที่ต้องสั่ง)\s*(.*)$/))) {
      return { do: 'buy_list', item: roundWords(m[1]) };
    }
    if (/^เพิ่ม(?:สต็อก|สต๊อก|สินค้า)(?:ในคลัง)?$/.test(t)) return { do: 'add_stock', item: '', qty: 0 };
    if ((m = t.match(/^(?:ไป|เปิด)(?:ที่)?(?:หน้า)?\s*(.+)$/))) {
      var want = m[1].replace(/[^฀-๿a-zA-Z]/g, '').toLowerCase();
      var clean = function (p) { return String(p.label || '').replace(/[^฀-๿a-zA-Z]/g, '').toLowerCase(); };
      var hit = want.length < 2 ? [] : (panels || []).filter(function (p) {
        var l = clean(p);
        return l && (l.indexOf(want) !== -1 || want.indexOf(l) !== -1);
      });
      // "สินค้า" is its own page and also part of "คลังสินค้า": the exact name wins
      var same = hit.filter(function (p) { return clean(p) === want; });
      if (same.length === 1) hit = same;
      if (hit.length === 1) return { do: 'goto', panel: hit[0].id };
    }
    return null;
  }

  // "รอบ Shutline", "Shutline รอบนี้" → "Shutline"; "รอบนี้" → "" (the round on screen)
  function roundWords(s) {
    return String(s || '').replace(/(?:ของ)?รอบ(?:นี้)?|รายการ(?:นี้)?|ลิสต์(?:นี้)?|ในนี้|นี้/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // What to buy for a round, the same way the order summary page counts it:
  // one entry per product, "Product (Variant)" lines grouped under the product,
  // most pieces first. Gifts are listed apart; cancelled lines are left out.
  // q: words of the round name (or, if no round matches, of a product name).
  // listId: a round chosen already (wins over q).
  function buyList(orders, q, listId) {
    var words = String(q || '').split(/\s+/).map(key).filter(Boolean);
    var has = function (s) { var k = key(s); return words.every(function (w) { return k.indexOf(w) !== -1; }); };
    var byId = {};
    orders.forEach(function (o) {
      var id = o.listId || o.shopName || '-';
      if (!byId[id]) byId[id] = { listId: o.listId || '', name: o.shopName || '-' };
    });
    var rounds = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (r) {
      return listId ? r.listId === listId : words.length && has(r.name);
    });
    var out = { rounds: rounds, byProduct: false, items: [], gifts: [], qty: 0, giftQty: 0, cancelled: 0 };
    if (rounds.length > 1) return out; // the admin picks one
    var rows;
    if (rounds.length) rows = orders.filter(function (o) { return (o.listId || o.shopName || '-') === (rounds[0].listId || rounds[0].name); });
    else if (words.length) { out.byProduct = true; rows = orders.filter(function (o) { return has(o.product); }); }
    else return out;
    var groups = {};
    rows.forEach(function (o) {
      if (o.status === 'ยกเลิก') { out.cancelled++; return; }
      var label = String(o.product || '').trim(), base = label, variant = '', m = label.match(/^(.*) \(([^()]*)\)$/);
      if (m) { base = m[1].trim(); variant = m[2].split(':')[0].trim(); }
      var gift = o.payType === 'Gift' || /^ของแถม/.test(base), q = Number(o.qty) || 0;
      var g = groups[base];
      if (!g) { g = groups[base] = { name: base, qty: 0, v: {}, gift: gift }; (gift ? out.gifts : out.items).push(g); }
      g.qty += q;
      if (variant) g.v[variant] = (g.v[variant] || 0) + q;
      if (gift) out.giftQty += q; else out.qty += q;
    });
    var tidy = function (list) {
      list.forEach(function (g) {
        g.variants = Object.keys(g.v).map(function (n) { return { name: n, qty: g.v[n] }; }).sort(function (a, b) { return b.qty - a.qty; });
        delete g.v; delete g.gift;
      });
      return list.sort(function (a, b) { return b.qty - a.qty; });
    };
    tidy(out.items); tidy(out.gifts);
    return out;
  }

  // One customer's orders. names: every customer the words match (an exact match wins);
  // rows are filled only when that is one person.
  function customer(orders, q) {
    var k = key(q), seen = {}, exact = false;
    if (!k) return { names: [], rows: [] };
    orders.forEach(function (o) {
      var c = key(o.customer);
      if (c.indexOf(k) === -1) return;
      if (c === k) exact = true;
      (seen[c] = seen[c] || { name: o.customer, rows: [] }).rows.push(o);
    });
    var keys = Object.keys(seen);
    if (exact) keys = [k];
    return { names: keys.map(function (c) { return seen[c].name; }), rows: keys.length === 1 ? seen[keys[0]].rows : [] };
  }

  // Sales between two Thai days (inclusive). An order line's worth is its full price;
  // lines with no price are counted apart, never as ฿0 (gifts are free by design).
  function sales(orders, from, to) {
    var out = { web: { lines: 0, qty: 0, baht: 0 }, pos: { lines: 0, qty: 0, baht: 0 }, noPrice: 0 };
    orders.forEach(function (o) {
      var d = day(o.timestamp);
      if (!d || d < from || d > to || o.status === 'ยกเลิก' || o.payType === 'Gift') return;
      var baht = Math.max(Number(o.total) || 0, Number(o.totalFull) || 0);
      if (!baht) { out.noPrice++; return; }
      var g = o.remark === 'POS' ? out.pos : out.web;
      g.lines++; g.qty += Number(o.qty) || 0; g.baht += baht;
    });
    return out;
  }

  // Orders still waiting to be shipped, per round (most first)
  function waiting(orders) {
    var by = {};
    orders.forEach(function (o) {
      if (o.shippedAt || o.status === 'ยกเลิก' || o.remark === 'POS') return;
      var g = by[o.shopName] = by[o.shopName] || { round: o.shopName || '-', lines: 0, who: {} };
      g.lines++; g.who[key(o.customer)] = 1;
    });
    return Object.keys(by).map(function (n) { return { round: by[n].round, lines: by[n].lines, customers: Object.keys(by[n].who).length }; })
      .sort(function (a, b) { return b.lines - a.lines; });
  }

  // Every countable warehouse row: a product without variants, or each variant.
  // free = on the shelf − reserved; null = no count (unlimited).
  function stockRows(stock) {
    var rows = [];
    (stock || []).forEach(function (p) {
      (p.children && p.children.length ? p.children : [null]).forEach(function (c) {
        var x = c || p, tracked = x.stock !== null && x.stock !== undefined && x.stock !== '';
        rows.push({
          parent: p, child: c, name: c ? p.name + ' — ' + c.name : p.name,
          shelf: tracked ? Number(x.stock) || 0 : null, held: Number(x.reserved) || 0,
          free: tracked ? Math.max(0, (Number(x.stock) || 0) - (Number(x.reserved) || 0)) : null
        });
      });
    });
    return rows;
  }
  // ponytail: "low" = 3 or fewer free pieces for every item; a per-item level if that is too blunt
  function lowStock(stock, max) {
    return stockRows(stock).filter(function (r) { return r.free !== null && r.free <= (max === undefined ? 3 : max); })
      .sort(function (a, b) { return a.free - b.free; });
  }
  // Rows whose name has every typed word
  function findItems(stock, q) {
    var words = String(q || '').split(/\s+/).map(key).filter(Boolean);
    if (!words.length) return [];
    return stockRows(stock).filter(function (r) {
      var n = key(r.name);
      return words.every(function (w) { return n.indexOf(w) !== -1; });
    });
  }

  var api = { key: key, day: day, stage: stage, local: local, roundWords: roundWords, buyList: buyList, customer: customer, sales: sales, waiting: waiting, stockRows: stockRows, lowStock: lowStock, findItems: findItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FayeBrain = api;
})(typeof window !== 'undefined' ? window : globalThis);
