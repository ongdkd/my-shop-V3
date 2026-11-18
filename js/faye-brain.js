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
  function local(text, panels, today) {
    var t = String(text || '').trim(), m;
    var when = period(t, today || day(new Date().toISOString()));
    if ((m = t.match(/^(?:ค้นหา|หา)\s+(.+)$/))) return { do: 'find_orders', query: m[1].trim() };
    // "Shutline ต้องสั่งอะไรบ้าง", "รอบนี้ต้องซื้อกี่ชิ้น", "สรุปยอดสั่ง Shutline" → what to buy for a round
    if ((m = t.match(/^(.*?)\s*(?:ต้อง\s*(?:สั่ง\s*ซื้อ|สั่ง|ซื้อ)?\s*(?:ของ)?|สั่ง\s*ของ|ซื้อ\s*ของ)\s*(?:อะไร\s*บ้าง|กี่\s*ชิ้น|เท่า\s*(?:ไร|ไหร่))/)) ||
        (m = t.match(/^สรุป\s*(?:ยอด)?\s*(?:สั่ง\s*(?:ซื้อ)?|ที่ต้องสั่ง)\s*(.*)$/))) {
      return { do: 'buy_list', item: roundWords(m[1]) };
    }
    if (/^เพิ่ม(?:สต็อก|สต๊อก|สินค้า)(?:ในคลัง)?$/.test(t)) return { do: 'add_stock', item: '', qty: 0 };
    // "ใครซื้อเยอะสุดเดือนนี้", "ลูกค้าคนไหนซื้อมากที่สุด"
    if (/(?:ใคร|ลูกค้า\s*(?:คน)?ไหน)\s*(?:ซื้อ|สั่ง)\s*(?:ของ)?\s*(?:เยอะ|มาก)\s*(?:ที่)?สุด/.test(t)) {
      return { do: 'top_customers', from: when.from, to: when.to, item: '', query: '' };
    }
    // "ใครซื้อสแตนดี้ Jay บ้าง" → who bought it, most first
    if ((m = t.match(/^ใคร\s*(?:ซื้อ|สั่ง)\s*(.+?)\s*(?:บ้าง|ไปบ้าง)\s*\??$/))) {
      return { do: 'top_customers', from: when.from, to: when.to, item: stripPeriod(m[1]), query: '' };
    }
    // "ขายอะไรดีสุด", "อะไรขายดีที่สุดเดือนนี้", "สินค้าขายดี"
    if (/(?:อะไร|ตัวไหน|ชิ้นไหน|สินค้า)\s*ขาย\s*ดี|ขาย\s*(?:อะไร|ตัวไหน)\s*ดี|ขายดี\s*(?:ที่)?สุด|best\s*sell/i.test(t)) {
      return { do: 'top_products', from: when.from, to: when.to, query: '' };
    }
    // "เทียบกับสัปดาห์ก่อน", "ยอดลดลงไหม", "ขายดีกว่าเดือนที่แล้วไหม"
    if (/เทียบ|ลดลง|เพิ่มขึ้น|ดีกว่า|แย่กว่า|น้อยกว่า|มากกว่า/.test(t) && /ยอด|ขาย/.test(t)) {
      var cmp = when.from ? when : period('7 วัน', today || day(new Date().toISOString()));
      return { do: 'sales_compare', from: cmp.from, to: cmp.to };
    }
    // "@kagayaku ซื้อไปทั้งหมดเท่าไร"
    if ((m = t.match(/^(@\S+)\s*(?:ซื้อ|สั่ง)\s*(?:ไป)?\s*(?:ทั้งหมด)?\s*(?:เท่า\s*(?:ไร|ไหร่)|กี่\s*(?:บาท|ชิ้น))/))) {
      return { do: 'customer_total', customer: m[1] };
    }
    // "วันนี้ขายได้เท่าไร" → sales;  "รอบ Shutline ขายได้เท่าไร", "รอบนี้ขายได้เท่าไร" → that round
    if ((m = t.match(/^(.*?)\s*ขาย\s*ได้\s*(?:เท่า\s*(?:ไร|ไหร่)|กี่\s*(?:บาท|ชิ้น))/))) {
      var what = stripPeriod(m[1]).replace(/^ยอด\s*/, '');
      if (!what && when.from) return { do: 'sales', from: when.from, to: when.to };
      if (/รอบ|รายการ|ลิสต์/.test(m[1]) || what) return { do: 'round_sales', query: roundWords(what), from: when.from, to: when.to };
    }
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

  // ── Periods: "วันนี้", "เมื่อวาน", "สัปดาห์นี้", "7 วัน", "เดือนนี้", "เดือนที่แล้ว", "ปีนี้" ──
  function shift(d, n) { return new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10); }
  var PERIODS = [
    [/วันนี้/, function (t) { return [t, t]; }],
    [/เมื่อวาน/, function (t) { return [shift(t, -1), shift(t, -1)]; }],
    [/(?:สัปดาห์|อาทิตย์)\s*(?:ที่แล้ว|ก่อน)/, function (t) { var w = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return [shift(t, -w - 7), shift(t, -w - 1)]; }],
    [/(?:สัปดาห์|อาทิตย์)\s*นี้/, function (t) { var w = (new Date(t + 'T00:00:00Z').getUTCDay() + 6) % 7; return [shift(t, -w), t]; }],
    [/7\s*วัน/, function (t) { return [shift(t, -6), t]; }],
    [/30\s*วัน/, function (t) { return [shift(t, -29), t]; }],
    [/เดือน\s*(?:ที่แล้ว|ก่อน)/, function (t) { var first = t.slice(0, 8) + '01'; var end = shift(first, -1); return [end.slice(0, 8) + '01', end]; }],
    [/เดือน\s*นี้/, function (t) { return [t.slice(0, 8) + '01', t]; }],
    [/ปี\s*นี้/, function (t) { return [t.slice(0, 5) + '01-01', t]; }],
  ];
  // The period named first in the sentence ("สัปดาห์นี้ดีกว่าสัปดาห์ก่อนไหม" → this week)
  function period(text, today) {
    var best = null;
    PERIODS.forEach(function (p) {
      var m = p[0].exec(text);
      if (m && (!best || m.index < best.at)) best = { at: m.index, fn: p[1] };
    });
    if (!best) return { from: '', to: '' };
    var r = best.fn(today);
    return { from: r[0], to: r[1] };
  }
  function stripPeriod(s) {
    var t = String(s || '');
    PERIODS.forEach(function (p) { t = t.replace(p[0], ' '); });
    return t.replace(/\s+/g, ' ').trim();
  }

  // ── Shared filters ──
  function inRange(o, from, to) {
    if (!from && !to) return true;
    var d = day(o.timestamp);
    return !!d && (!from || d >= from) && (!to || d <= to);
  }
  function words(q) { return String(q || '').split(/\s+/).map(key).filter(Boolean); }
  function hasAll(text, ws) { var k = key(text); return ws.every(function (w) { return k.indexOf(w) !== -1; }); }
  // A line's worth: its full price (a deposit line counts the whole item); gifts are free
  function worth(o) { return o.payType === 'Gift' ? 0 : Math.max(Number(o.total) || 0, Number(o.totalFull) || 0); }
  // "Shutline X Mercury Nov26 MD - สแตนดี้" sold in that round → "สแตนดี้"
  function shortName(name, round) {
    var n = String(name || ''), r = String(round || '').trim();
    if (!r || n.toLowerCase().indexOf(r.toLowerCase()) !== 0) return n;
    return n.slice(r.length).replace(/^[\s\-–:]+/, '') || n;
  }
  function productBase(name) { var m = String(name || '').trim().match(/^(.*) \(([^()]*)\)$/); return m ? m[1].trim() : String(name || '').trim(); }

  // Who bought the most (by baht; by pieces when an item is named). Walk-in POS sales
  // and gifts left out. opt: { from, to, item, round }
  function topCustomers(orders, opt) {
    opt = opt || {};
    var iw = words(opt.item), rw = words(opt.round), by = {}, totalBaht = 0, totalQty = 0;
    orders.forEach(function (o) {
      if (o.status === 'ยกเลิก' || o.remark === 'POS' || o.payType === 'Gift' || !inRange(o, opt.from, opt.to)) return;
      if (iw.length && !hasAll(o.product, iw)) return;
      if (rw.length && !hasAll(o.shopName, rw)) return;
      var k = key(o.customer), g = by[k] = by[k] || { name: o.customer, baht: 0, qty: 0, lines: 0 };
      g.baht += worth(o); g.qty += Number(o.qty) || 0; g.lines++;
      totalBaht += worth(o); totalQty += Number(o.qty) || 0;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(iw.length
      ? function (a, b) { return b.qty - a.qty || b.baht - a.baht; }
      : function (a, b) { return b.baht - a.baht || b.qty - a.qty; });
    return { rows: rows, baht: totalBaht, qty: totalQty, byQty: iw.length > 0 };
  }

  // Best sellers by pieces ("Product (Variant)" counted under the product); gifts left out, POS included
  function topProducts(orders, opt) {
    opt = opt || {};
    var rw = words(opt.round), by = {};
    orders.forEach(function (o) {
      if (o.status === 'ยกเลิก' || o.payType === 'Gift' || /^ของแถม/.test(o.product) || !inRange(o, opt.from, opt.to)) return;
      if (rw.length && !hasAll(o.shopName, rw)) return;
      var n = productBase(o.product), g = by[n] = by[n] || { name: n, round: o.shopName || '', qty: 0, baht: 0, buyers: {} };
      g.qty += Number(o.qty) || 0; g.baht += worth(o); g.buyers[key(o.customer)] = 1;
    });
    return Object.keys(by).map(function (k) {
      var g = by[k]; return { name: g.name, short: shortName(g.name, g.round), qty: g.qty, baht: g.baht, buyers: Object.keys(g.buyers).length };
    }).sort(function (a, b) { return b.qty - a.qty || b.baht - a.baht; });
  }

  // One customer's totals; names: every match (rows only when it's one person)
  function customerTotal(orders, q) {
    var c = customer(orders, q);
    var out = { names: c.names, baht: 0, qty: 0, lines: 0, rounds: 0, cancelled: 0, first: '', last: '', top: [] };
    if (!c.rows.length) return out;
    var rounds = {}, items = {};
    c.rows.forEach(function (o) {
      if (o.status === 'ยกเลิก') { out.cancelled++; return; }
      out.baht += worth(o); out.qty += Number(o.qty) || 0; out.lines++;
      rounds[o.listId || o.shopName] = 1;
      var d = day(o.timestamp);
      if (d && (!out.first || d < out.first)) out.first = d;
      if (d && d > out.last) out.last = d;
      if (o.payType !== 'Gift') { var n = shortName(productBase(o.product), o.shopName); items[n] = (items[n] || 0) + (Number(o.qty) || 0); }
    });
    out.rounds = Object.keys(rounds).length;
    out.top = Object.keys(items).map(function (n) { return { name: n, qty: items[n] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 3);
    return out;
  }

  // One round's sales. q: words of its name, or listId (the round on screen)
  function roundSales(orders, q, listId, from, to) {
    var rw = words(q), by = {};
    orders.forEach(function (o) {
      var id = o.listId || o.shopName || '-';
      if (!by[id]) by[id] = { listId: o.listId || '', name: o.shopName || '-' };
    });
    var rounds = Object.keys(by).map(function (k) { return by[k]; }).filter(function (r) {
      return listId ? r.listId === listId : rw.length && hasAll(r.name, rw);
    });
    var out = { rounds: rounds, baht: 0, qty: 0, lines: 0, customers: 0, waiting: 0, shipped: 0, pos: 0, cancelled: 0 };
    if (rounds.length !== 1) return out;
    var r = rounds[0], who = {};
    orders.forEach(function (o) {
      if ((o.listId || o.shopName || '-') !== (r.listId || r.name) || !inRange(o, from, to)) return;
      if (o.status === 'ยกเลิก') { out.cancelled++; return; }
      out.baht += worth(o); out.lines++;
      if (o.payType !== 'Gift') out.qty += Number(o.qty) || 0;
      if (o.remark === 'POS') out.pos += worth(o);
      else { who[key(o.customer)] = 1; if (o.shippedAt) out.shipped++; else out.waiting++; }
    });
    out.customers = Object.keys(who).length;
    return out;
  }

  // This period against the one before it: this week (from Monday) vs the same days last week,
  // this month (from the 1st) vs the same dates last month, otherwise the same number of days just before
  function salesCompare(orders, from, to) {
    var len = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1, pFrom, pTo;
    var monday = new Date(from + 'T00:00:00Z').getUTCDay() === 1;
    if (from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7) && len > 7) {
      var prevEnd = shift(from, -1), prevStart = prevEnd.slice(0, 8) + '01';
      pFrom = prevStart; pTo = prevStart.slice(0, 8) + ('0' + Math.min(Number(to.slice(8)), Number(prevEnd.slice(8)))).slice(-2);
    } else if (monday && len <= 7) {
      pFrom = shift(from, -7); pTo = shift(to, -7);
    } else {
      pFrom = shift(from, -len); pTo = shift(from, -1);
    }
    var now = sales(orders, from, to), before = sales(orders, pFrom, pTo);
    var a = now.web.baht + now.pos.baht, b = before.web.baht + before.pos.baht;
    return { from: from, to: to, prevFrom: pFrom, prevTo: pTo, now: a, before: b,
      nowQty: now.web.qty + now.pos.qty, beforeQty: before.web.qty + before.pos.qty,
      change: b ? Math.round((a - b) / b * 100) : null };
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

  var api = { key: key, day: day, stage: stage, local: local, roundWords: roundWords, buyList: buyList,
    period: period, shift: shift, topCustomers: topCustomers, topProducts: topProducts, customerTotal: customerTotal,
    roundSales: roundSales, salesCompare: salesCompare, customer: customer, sales: sales, waiting: waiting, stockRows: stockRows, lowStock: lowStock, findItems: findItems };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FayeBrain = api;
})(typeof window !== 'undefined' ? window : globalThis);
