// status.js — customer order status + payment slip page (status.html)
(function () {
  'use strict';

  var JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  var JSQR_SRI = 'sha384-hStSInNIZ8ljtOVrmrgf7zdHMapaLBWoSnPTtF0nzsybp4+LuhDz6sHuEVpWIX8o';
  var MAX_SLIP_CHARS = 600000; // the database accepts up to 700k

  var $ = function (id) { return document.getElementById(id); };
  var current = { name: '', listId: '', deliveryId: '', slip: '', ref: '', tab: '' };

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    return new Promise(function (resolve) {
      var run = google.script.run.withSuccessHandler(function (r) {
        try { resolve(JSON.parse(r)); } catch (e) { resolve({ status: 'Error', message: 'เกิดข้อผิดพลาด' }); }
      }).withFailureHandler(function (e) { resolve({ status: 'Error', message: (e && e.message) || 'เชื่อมต่อไม่ได้' }); });
      run[fn].apply(run, args);
    });
  }
  var toastTimer;
  function toast(msg, type) {
    var t = $('stToast'); t.textContent = msg; t.className = type || ''; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; } }
  function baht(n) { return '฿' + (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }); }
  function day(d) { return d ? new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : ''; }

  // ── Status pill + tracking ────────────────────────────────
  function trackingLine(no, courier, status) {
    var line = h('div', 'st-track', 'เลขพัสดุ ' + (courier ? Couriers.name(courier) + ' ' : ''));
    var a = h('a', '', no);
    a.href = Couriers.trackUrl(courier, no);
    a.target = '_blank'; a.rel = 'noopener';
    line.appendChild(a);
    if (status) line.appendChild(h('div', 'st-track-status', status));
    return line;
  }
  function webStatus(o) {
    if (o.shippedAt) return { text: 'จัดส่งแล้ว ' + day(o.shippedAt), cls: 'shipped' };
    if (o.status === 'ยกเลิก') return { text: 'ยกเลิก', cls: 'cancel' };
    if (o.status) return { text: o.status, cls: 'custom' };
    return { text: 'รอจัดส่ง', cls: '' };
  }
  function sheetStatus(s) {
    var v = String(s || '').trim();
    if (/จัดส่งแล้ว/.test(v)) return { text: v, cls: 'shipped' };
    if (/cancel|cancle|ยกเลิก/i.test(v)) return { text: 'ยกเลิก', cls: 'cancel' };
    return { text: v || 'รอจัดส่ง', cls: v ? 'custom' : '' };
  }
  function itemRow(name, qty, st, tracking, note, courier, trackStatus) {
    var row = h('div', 'st-item');
    var main = h('div', 'st-item-main');
    main.appendChild(h('div', 'st-item-name', name));
    main.appendChild(h('span', 'st-pill ' + st.cls, st.text));
    if (tracking) main.appendChild(trackingLine(tracking, courier, trackStatus));
    if (note) main.appendChild(h('div', 'st-note-line', note));
    row.appendChild(main);
    row.appendChild(h('div', 'st-item-qty', '×' + qty));
    return row;
  }

  // ── Tabs: which stage each item is at ─────────────────────
  // A slip sent for the list pays it (deposit or full price). Once items
  // arrive the shop puts them in delivery bills (deliveryId), which the
  // customer pays — the rest of the price + delivery fee — in tab 3.
  var TABS = [
    { id: 'pay', label: 'รอชำระเงิน', empty: 'ไม่มีรายการที่รอชำระเงิน' },
    { id: 'arrive', label: 'รอสินค้าถึงไทย', empty: 'ไม่มีรายการที่รอสินค้าถึงไทย' },
    { id: 'balance', label: 'ชำระส่วนที่เหลือ / ค่าส่ง', empty: 'ยังไม่มีบิลค่าส่ง — ร้านจะสรุปยอดให้เมื่อสินค้าถึงไทย' },
    { id: 'done', label: 'สำเร็จแล้ว', empty: 'ยังไม่มีรายการที่จัดส่งแล้ว' }
  ];
  var ARRIVED = /ถึงไทย/;
  // The shop can mark items paid without a slip ("ชำระแล้ว", e.g. paid in cash); arrived items are paid too
  var PAID = /ชำระแล้ว|ถึงไทย/;
  function webStage(o, paidList) {
    if (o.shippedAt || o.status === 'ยกเลิก') return 'done';
    if (o.deliveryId) return 'balance';
    return paidList[o.listId] || PAID.test(o.status || '') ? 'arrive' : 'pay';
  }
  // Old sheet rows carry no payment info; anything still open was ordered and paid for
  function legacyStage(s) {
    var v = String(s || '').trim();
    if (/จัดส่งแล้ว/.test(v) || /cancel|cancle|ยกเลิก/i.test(v)) return 'done';
    return ARRIVED.test(v) ? 'balance' : 'arrive';
  }
  function restOf(o) {
    return o.payType === 'Deposit' && Number(o.totalFull) > Number(o.total) ? Number(o.totalFull) - Number(o.total) : 0;
  }
  function itemName(o) {
    return o.product + (o.payType === 'Deposit' ? ' (มัดจำ)' : o.payType === 'Gift' ? ' (ของแถม)' : '');
  }
  // The amount to pay, big, where the customer looks for it
  function amountBox(label, amount) {
    var box = h('div', 'st-due');
    box.appendChild(h('div', 'st-due-label', label));
    box.appendChild(h('div', 'st-due-amount', amount));
    return box;
  }
  function payButton(text, onClick, ghost) {
    var btn = h('button', 'st-btn sm' + (ghost ? ' ghost' : ''), text);
    btn.type = 'button';
    btn.onclick = onClick;
    return btn;
  }

  // ── Results ───────────────────────────────────────────────
  function render(res) {
    var out = $('stResult'); out.textContent = '';
    var orders = res.orders || [], pays = res.payments || [], legacy = res.legacy || [];
    if (!orders.length && !legacy.length) {
      out.appendChild(h('div', 'st-empty', 'ไม่พบคำสั่งซื้อของชื่อนี้ — ตรวจสอบตัวสะกดของชื่อ @ อีกครั้งนะคะ'));
      return;
    }

    var paidList = {};
    pays.forEach(function (p) { if (!p.deliveryId) paidList[p.listId] = true; });
    var groups = {};
    TABS.forEach(function (t) { groups[t.id] = { orders: [], legacy: [] }; });
    orders.forEach(function (o) { groups[webStage(o, paidList)].orders.push(o); });
    legacy.forEach(function (r) { groups[legacyStage(r.status)].legacy.push(r); });
    var ctx = { pays: pays, bills: {}, trackStatus: {} };
    (res.deliveries || []).forEach(function (d) {
      ctx.bills[d.id] = d;
      if (d.tracking && d.ishipStatus) ctx.trackStatus[d.tracking] = d.ishipStatus; // kept fresh by iShip
    });

    // One per checkout (its rows are written in one transaction, so they
    // share created_at); in the bills tab, one per bill
    function count(id) {
      var seen = {}, n = 0;
      groups[id].orders.forEach(function (o) {
        var k = id === 'balance' ? o.deliveryId : o.listId + '|' + o.createdAt;
        if (!seen[k]) { seen[k] = true; n++; }
      });
      return n + groups[id].legacy.length;
    }

    if (!TABS.some(function (t) { return t.id === current.tab; })) {
      var first = TABS.filter(function (t) { return count(t.id); })[0];
      current.tab = first ? first.id : TABS[0].id;
    }

    var bar = h('div', 'st-tabs');
    bar.setAttribute('role', 'tablist');
    var panel = h('div', 'st-panel');
    panel.setAttribute('role', 'tabpanel');
    TABS.forEach(function (t) {
      var b = h('button', 'st-tab');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.id === current.tab ? 'true' : 'false');
      b.appendChild(h('span', 'st-tab-label', t.label));
      b.appendChild(h('span', 'st-tab-count', count(t.id)));
      b.onclick = function () {
        current.tab = t.id;
        Array.prototype.forEach.call(bar.children, function (c) { c.setAttribute('aria-selected', c === b ? 'true' : 'false'); });
        renderTab(panel, t, groups[t.id], ctx);
      };
      bar.appendChild(b);
    });
    out.appendChild(bar);
    out.appendChild(panel);
    renderTab(panel, TABS.filter(function (t) { return t.id === current.tab; })[0], groups[current.tab], ctx);
  }

  function renderTab(out, tab, group, ctx) {
    out.textContent = '';
    var orders = group.orders, legacy = group.legacy;
    if (!orders.length && !legacy.length) { out.appendChild(h('div', 'st-empty', tab.empty)); return; }

    if (tab.id === 'balance') renderBills(out, orders, ctx);
    else renderLists(out, tab, orders, ctx, !!legacy.length);

    // Old orders from the status sheet, one card per quarter tab
    if (legacy.length) {
      out.appendChild(h('h2', 'st-section', 'ประวัติคำสั่งซื้อก่อนหน้า'));
      var rounds = [], byRound = {};
      legacy.forEach(function (r) {
        if (!byRound[r.round]) { byRound[r.round] = []; rounds.push(r.round); }
        byRound[r.round].push(r);
      });
      rounds.forEach(function (round) {
        var card = h('section', 'st-card');
        var head = h('div', 'st-card-head');
        head.appendChild(h('div', 'st-card-name', round));
        head.appendChild(h('div', 'st-card-meta', byRound[round].length + ' รายการ'));
        card.appendChild(head);
        byRound[round].forEach(function (r) { card.appendChild(itemRow(r.product, r.qty || '1', sheetStatus(r.status), r.tracking, r.note)); });
        out.appendChild(card);
      });
    }
  }

  // Tabs 1, 2, 4: one card per order list (newest first)
  function renderLists(out, tab, orders, ctx, hasLegacy) {
    var lists = [], byList = {};
    orders.forEach(function (o) {
      if (!byList[o.listId]) { byList[o.listId] = { id: o.listId, name: o.listName, items: [] }; lists.push(byList[o.listId]); }
      byList[o.listId].items.push(o);
    });
    if (lists.length && hasLegacy) out.appendChild(h('h2', 'st-section', 'คำสั่งซื้อบนเว็บ'));
    lists.forEach(function (l) {
      var card = h('section', 'st-card');
      var head = h('div', 'st-card-head');
      head.appendChild(h('div', 'st-card-name', l.name));
      var pcs = 0, sum = 0, owed = 0;
      l.items.forEach(function (o) {
        if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
        sum += Number(o.total) || 0;
        owed += restOf(o);
      });
      var mine = ctx.pays.filter(function (p) { return p.listId === l.id && !p.deliveryId; });
      var sent = mine.length ? '✓ ส่งสลิปแล้ว ' + mine.length + ' ครั้ง' : 'ยังไม่ได้ส่งสลิป';
      head.appendChild(h('div', 'st-card-meta' + (mine.length ? ' ok' : ''), tab.id === 'done' ? pcs + ' ชิ้น · ' + baht(sum) : sent));
      card.appendChild(head);
      l.items.forEach(function (o) {
        var st = webStatus(o);
        if (tab.id === 'arrive' && ARRIVED.test(o.status)) st = { text: 'ถึงไทยแล้ว · รอร้านสรุปค่าส่ง', cls: 'custom' };
        card.appendChild(itemRow(itemName(o), o.qty, st, o.shippedAt ? o.tracking : '', '', o.courier, ctx.trackStatus[o.tracking]));
      });

      var foot = h('div', 'st-card-foot');
      if (tab.id === 'pay') {
        foot.appendChild(amountBox('ยอดที่ต้องโอน · ' + pcs + ' ชิ้น', baht(sum)));
        foot.appendChild(payButton('ส่งสลิป', function () { openPay({ listId: l.id, title: l.name, amount: sum }); }));
      } else if (tab.id === 'arrive') {
        foot.appendChild(amountBox(owed > 0 ? 'ส่วนที่เหลือ (ชำระเมื่อของถึงไทย) + ค่าส่ง' : 'ชำระครบแล้ว · รอค่าส่งเมื่อของถึงไทย',
          owed > 0 ? baht(owed) : '✓'));
        // No slip here: the rest + delivery fee is paid with the shop's bill in tab 3
      } else if (mine.length) {
        foot.appendChild(h('div', 'st-paid ok', sent));
      } else { out.appendChild(card); return; }
      card.appendChild(foot);
      out.appendChild(card);
    });
  }

  // Tab 3: one card per delivery bill the shop made (may mix lists)
  function renderBills(out, orders, ctx) {
    var ids = [], byBill = {};
    orders.forEach(function (o) {
      if (!byBill[o.deliveryId]) { byBill[o.deliveryId] = []; ids.push(o.deliveryId); }
      byBill[o.deliveryId].push(o);
    });
    ids.forEach(function (id, i) {
      var items = byBill[id], bill = ctx.bills[id] || { fee: null };
      var paid = ctx.pays.filter(function (p) { return p.deliveryId === id; });
      var card = h('section', 'st-card');
      var head = h('div', 'st-card-head');
      head.appendChild(h('div', 'st-card-name', 'บิลค่าส่ง ' + (ids.length > 1 ? i + 1 : '') + (bill.createdAt ? ' · ' + day(bill.createdAt) : '')));
      head.appendChild(h('div', 'st-card-meta' + (paid.length ? ' ok' : ''), paid.length ? '✓ โอนแล้ว ' + baht(paid[0].amount) : 'ยังไม่ได้โอน'));
      card.appendChild(head);
      var rest = 0, pcs = 0;
      items.forEach(function (o) {
        rest += restOf(o);
        if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
        var row = itemRow(itemName(o), o.qty, { text: o.listName, cls: '' }, '', restOf(o) ? 'ส่วนที่เหลือ ' + baht(restOf(o)) : '');
        card.appendChild(row);
      });
      var foot = h('div', 'st-card-foot');
      if (bill.fee === null || bill.fee === undefined) {
        foot.appendChild(amountBox('ส่วนที่เหลือ ' + baht(rest) + ' + ค่าส่ง', 'รอร้านแจ้งค่าส่ง'));
      } else {
        var total = rest + Number(bill.fee);
        foot.appendChild(amountBox('ยอดที่ต้องโอน · ' + pcs + ' ชิ้น (ส่วนที่เหลือ ' + baht(rest) + ' + ค่าส่ง ' + baht(bill.fee) + ')', baht(total)));
        if (paid.length) {
          foot.appendChild(payButton('แก้ที่อยู่', function () { openPay({ deliveryId: id, listId: items[0].listId, title: 'บิลค่าส่ง', amount: paid[0].amount, address: true }); }, true));
        } else {
          foot.appendChild(payButton('ส่งสลิป / ที่อยู่', function () { openPay({ deliveryId: id, listId: items[0].listId, title: 'บิลค่าส่ง', amount: total, address: true }); }));
        }
      }
      card.appendChild(foot);
      out.appendChild(card);
    });
  }

  function lookup(name) {
    var btn = $('stGo'); btn.disabled = true; btn.textContent = 'กำลังค้นหา...';
    $('stResult').textContent = '';
    return call('customerLookup', name).then(function (res) {
      btn.disabled = false; btn.textContent = 'ค้นหา';
      if (res.status !== 'Success') { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return; }
      if (name !== current.name) current.tab = ''; // a new name opens its first busy tab
      current.name = name; store('_custName', name);
      render(res);
    });
  }

  // ── Slip form ─────────────────────────────────────────────
  function localNow() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  // target: { listId, deliveryId?, title, amount, address? } — the address
  // is only asked for with the final payment (a delivery bill)
  function openPay(target) {
    current.listId = target.listId; current.deliveryId = target.deliveryId || '';
    current.slip = ''; current.ref = '';
    $('payForm').reset();
    $('payTitle').textContent = target.address ? 'ส่งสลิป / ที่อยู่จัดส่ง' : 'ส่งสลิปโอนเงิน';
    $('payList').textContent = target.title + ' · ' + current.name;
    if (target.amount > 0) $('payAmount').value = Math.round(target.amount * 100) / 100;
    $('payTime').value = localNow();
    $('payAddrBox').hidden = !target.address;
    $('payPasteBox').hidden = true;
    var saved = {};
    try { saved = JSON.parse(store('stAddrParts') || '{}') || {}; } catch (e) { saved = {}; }
    setParts(target.address ? saved : {});
    if (target.address) ThaiAddress.load().catch(function () {});
    $('paySlipPreview').hidden = true;
    $('paySend').disabled = true; // until a slip with a readable QR is picked
    $('payDialog').showModal();
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้')); };
      img.src = url;
    });
  }
  function draw(img, maxSide) {
    var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  // Small JPEG for storage: shrink until it fits
  function compress(img) {
    var sides = [1400, 1100, 900], q = [0.72, 0.65, 0.6];
    for (var i = 0; i < sides.length; i++) {
      var data = draw(img, sides[i]).toDataURL('image/jpeg', q[i]);
      if (data.length <= MAX_SLIP_CHARS) return data;
    }
    return '';
  }

  var jsqrLoading = null;
  function loadJsQR() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (jsqrLoading) return jsqrLoading;
    jsqrLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = JSQR_SRC; s.integrity = JSQR_SRI; s.crossOrigin = 'anonymous';
      s.onload = function () { resolve(window.jsQR); };
      s.onerror = function () { jsqrLoading = null; reject(new Error('jsQR')); };
      document.head.appendChild(s);
    });
    return jsqrLoading;
  }
  // A bank transaction reference: letters and digits only (same rule as the database)
  var REF_RE = /^[A-Za-z0-9]{8,64}$/;
  // Thai bank slips carry a mini QR: TLV with tag 00 holding the bank's
  // transaction reference in sub-tag 02. Falls back to the raw payload, which
  // only counts if it looks like a reference (not a PromptPay or web QR).
  function slipRef(payload) {
    function tlv(str) {
      var out = {}, i = 0;
      while (i + 4 <= str.length) {
        var tag = str.substr(i, 2), len = parseInt(str.substr(i + 2, 2), 10);
        if (isNaN(len)) break;
        out[tag] = str.substr(i + 4, len); i += 4 + len;
      }
      return out;
    }
    var top = tlv(payload);
    var ref = (top['00'] ? tlv(top['00'])['02'] || '' : '').trim();
    if (REF_RE.test(ref)) return ref;
    return REF_RE.test(payload.trim()) ? payload.trim() : '';
  }
  // Resolves to the reference, or '' when the image has no slip QR.
  // Rejects when the QR reader itself can't load.
  function readQR(img) {
    return loadJsQR().then(function (jsQR) {
      // Slip QRs are small; try a few sizes, the last pass also for light-on-dark codes
      var sizes = [1600, 1000, 2200, 700];
      for (var i = 0; i < sizes.length; i++) {
        var c = draw(img, sizes[i]);
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        var code = jsQR(d.data, d.width, d.height, { inversionAttempts: i === sizes.length - 1 ? 'attemptBoth' : 'dontInvert' });
        var ref = code && code.data ? slipRef(code.data) : '';
        if (ref) return ref;
      }
      return '';
    }, function () { throw new Error('โหลดตัวอ่าน QR ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วเลือกรูปใหม่'); });
  }

  $('paySlip').addEventListener('change', function () {
    var f = this.files && this.files[0];
    current.slip = ''; current.ref = '';
    var prev = $('paySlipPreview');
    if (!f) { prev.hidden = true; return; }
    $('paySend').disabled = true;
    $('payRef').textContent = 'กำลังอ่านสลิป...';
    loadImage(f).then(function (img) {
      current.slip = compress(img);
      prev.querySelector('img').src = current.slip || img.src;
      prev.hidden = false;
      if (!current.slip) throw new Error('รูปใหญ่เกินไป กรุณาครอปให้เหลือเฉพาะสลิป');
      return readQR(img).then(function (ref) {
        current.ref = ref;
        $('payRef').textContent = ref ? '✓ เลขอ้างอิง ' + ref
          : '✗ ไม่พบ QR ของสลิป — กรุณาใช้รูปสลิปจากแอปธนาคาร (แคปหน้าจอเต็ม ไม่ครอป QR มุมสลิปออก)';
        $('payRef').classList.toggle('bad', !ref);
      });
    }).catch(function (e) {
      $('payRef').textContent = '';
      toast(e.message || 'อ่านรูปไม่ได้', 'error');
    }).then(function () {
      // Every slip must carry its bank reference: it's how a slip used twice is caught
      $('paySend').disabled = !current.ref;
    });
  });

  $('payCancel').onclick = function () { $('payDialog').close(); };

  // ── Delivery address fields ───────────────────────────────
  var ADDR = { name: 'payName', phone: 'payPhone', address: 'payLine', district: 'payDistrict', amphoe: 'payAmphoe', province: 'payProvince', zipcode: 'payZip' };
  function getParts() { var o = {}; Object.keys(ADDR).forEach(function (k) { o[k] = $(ADDR[k]).value.trim(); }); o.phone = o.phone.replace(/[\s-]/g, ''); return o; }
  function setParts(p) { Object.keys(ADDR).forEach(function (k) { $(ADDR[k]).value = (p && p[k]) || ''; }); }
  function addrProblem(p) {
    if (Object.keys(ADDR).some(function (k) { return !p[k]; })) return 'กรุณากรอกที่อยู่จัดส่งให้ครบทุกช่อง';
    if (!/^0\d{8,9}$/.test(p.phone)) return 'เบอร์โทรไม่ถูกต้อง';
    if (!/^\d{5}$/.test(p.zipcode)) return 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก';
    return '';
  }
  ThaiAddress.attach({ district: $('payDistrict'), amphoe: $('payAmphoe'), province: $('payProvince'), zipcode: $('payZip') });
  $('payPasteToggle').onclick = function () { $('payPasteBox').hidden = !$('payPasteBox').hidden; if (!$('payPasteBox').hidden) $('payPaste').focus(); };
  $('payPasteGo').onclick = function () {
    ThaiAddress.load().then(function () {
      var p = ThaiAddress.parse($('payPaste').value);
      Object.keys(ADDR).forEach(function (k) { if (p[k]) $(ADDR[k]).value = p[k]; });
      $('payPasteBox').hidden = true;
      toast(p.district ? 'แยกที่อยู่แล้ว กรุณาตรวจสอบอีกครั้ง' : 'หาตำบล/อำเภอไม่เจอ กรุณาพิมพ์แล้วเลือกจากรายการ', p.district ? 'success' : 'error');
    }, function () { toast('โหลดข้อมูลที่อยู่ไม่สำเร็จ กรุณากรอกเอง', 'error'); });
  };

  $('payForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current.slip) { toast('กรุณาแนบรูปสลิป', 'error'); return; }
    if (!current.ref) { toast('ไม่พบ QR บนสลิป กรุณาเลือกรูปสลิปจากแอปธนาคาร', 'error'); return; }
    var amount = Number($('payAmount').value);
    if (!(amount > 0)) { toast('กรุณากรอกยอดโอน', 'error'); return; }
    var t = $('payTime').value ? new Date($('payTime').value) : null;
    var parts = $('payAddrBox').hidden ? null : getParts();
    var bad = parts ? addrProblem(parts) : '';
    if (bad) { toast(bad, 'error'); return; }
    var btn = $('paySend'); btn.disabled = true; btn.textContent = 'กำลังส่ง...';
    // The courier needs a real subdistrict / district / province / postcode;
    // if the address data can't load, don't block the payment over it
    var checked = parts ? ThaiAddress.load().then(function () { return ThaiAddress.valid(parts); }, function () { return true; }) : Promise.resolve(true);
    checked.then(function (ok) {
      if (!ok) { btn.disabled = false; btn.textContent = 'ส่ง'; toast('กรุณาเลือกตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์จากรายการ', 'error'); return null; }
      return call('customerSubmitPayment', current.name, current.listId, amount,
        t && !isNaN(t.getTime()) ? t.toISOString() : null, current.ref, parts ? ThaiAddress.format(parts) : '', current.slip, current.deliveryId, parts);
    }).then(function (res) {
        if (!res) return;
        btn.disabled = false; btn.textContent = 'ส่ง';
        if (res.status !== 'Success') { toast(res.message || 'ส่งไม่สำเร็จ', 'error'); return; }
        if (parts) store('stAddrParts', JSON.stringify(parts));
        $('payDialog').close();
        toast(res.addressUpdated ? 'แก้ที่อยู่จัดส่งเรียบร้อยค่ะ' : 'ส่งสลิปเรียบร้อย ขอบคุณค่ะ', 'success');
        lookup(current.name);
      });
  });

  $('stForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('stName').value.trim();
    if (name.replace(/^@+/, '').length < 2) { toast('กรุณากรอกชื่อ @ ของคุณ', 'error'); return; }
    lookup(name);
  });

  // Same name the shop page remembered; ?name= works for shared links
  var start = new URLSearchParams(location.search).get('name') || store('_custName');
  if (start) { $('stName').value = start; lookup(start); }
})();
