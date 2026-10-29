// status.js — customer order status + payment slip page (status.html)
(function () {
  'use strict';

  var JSQR_SRC = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
  var JSQR_SRI = 'sha384-hStSInNIZ8ljtOVrmrgf7zdHMapaLBWoSnPTtF0nzsybp4+LuhDz6sHuEVpWIX8o';
  var MAX_SLIP_CHARS = 600000; // the database accepts up to 700k

  var $ = function (id) { return document.getElementById(id); };
  var current = { name: '', listId: '', slip: '', ref: '' };

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
  function trackingLine(no) {
    var line = h('div', 'st-track', 'เลขพัสดุ ');
    if (/TH$/.test(no)) {
      var a = h('a', '', no);
      a.href = 'https://track.thailandpost.co.th/?trackNumber=' + encodeURIComponent(no);
      a.target = '_blank'; a.rel = 'noopener';
      line.appendChild(a);
    } else line.appendChild(document.createTextNode(no));
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
  function itemRow(name, qty, st, tracking, note) {
    var row = h('div', 'st-item');
    var main = h('div', 'st-item-main');
    main.appendChild(h('div', 'st-item-name', name));
    main.appendChild(h('span', 'st-pill ' + st.cls, st.text));
    if (tracking) main.appendChild(trackingLine(tracking));
    if (note) main.appendChild(h('div', 'st-note-line', note));
    row.appendChild(main);
    row.appendChild(h('div', 'st-item-qty', '×' + qty));
    return row;
  }

  // ── Results ───────────────────────────────────────────────
  function render(res) {
    var out = $('stResult'); out.textContent = '';
    var orders = res.orders || [], pays = res.payments || [], legacy = res.legacy || [];
    if (!orders.length && !legacy.length) {
      out.appendChild(h('div', 'st-empty', 'ไม่พบคำสั่งซื้อของชื่อนี้ — ตรวจสอบตัวสะกดของชื่อ @ อีกครั้งนะคะ'));
      return;
    }

    // Web orders, one card per order list (newest first)
    var lists = [], byList = {};
    orders.forEach(function (o) {
      if (!byList[o.listId]) { byList[o.listId] = { id: o.listId, name: o.listName, items: [] }; lists.push(byList[o.listId]); }
      byList[o.listId].items.push(o);
    });
    if (lists.length) out.appendChild(h('h2', 'st-section', 'คำสั่งซื้อบนเว็บ'));
    lists.forEach(function (l) {
      var card = h('section', 'st-card');
      var head = h('div', 'st-card-head');
      head.appendChild(h('div', 'st-card-name', l.name));
      var pcs = 0, sum = 0, owed = 0;
      l.items.forEach(function (o) {
        if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
        sum += Number(o.total) || 0;
        if (o.payType === 'Deposit' && Number(o.totalFull) > Number(o.total)) owed += Number(o.totalFull) - Number(o.total);
      });
      head.appendChild(h('div', 'st-card-meta', pcs + ' ชิ้น · ' + baht(sum)));
      card.appendChild(head);
      l.items.forEach(function (o) {
        var name = o.product + (o.payType === 'Deposit' ? ' (มัดจำ)' : o.payType === 'Gift' ? ' (ของแถม)' : '');
        card.appendChild(itemRow(name, o.qty, webStatus(o), o.shippedAt ? o.tracking : '', ''));
      });

      var foot = h('div', 'st-card-foot');
      var mine = pays.filter(function (p) { return p.listId === l.id; });
      var waiting = l.items.some(function (o) { return !o.shippedAt && o.status !== 'ยกเลิก'; });
      var paidText = mine.length
        ? '✓ ส่งสลิปแล้ว ' + mine.length + ' ครั้ง · ล่าสุด ' + baht(mine[0].amount) + (mine.some(function (p) { return p.hasAddress; }) ? ' · มีที่อยู่แล้ว' : '')
        : !waiting ? '' : owed > 0 ? 'ค้างชำระส่วนที่เหลือ ' + baht(owed) + ' (+ค่าส่ง)' : 'ยังไม่ได้ส่งสลิป';
      if (!paidText && !waiting) { out.appendChild(card); return; }
      foot.appendChild(h('div', 'st-paid' + (mine.length ? ' ok' : ''), paidText));
      if (waiting) {
        var btn = h('button', 'st-btn sm', 'ส่งสลิป / ที่อยู่');
        btn.type = 'button';
        btn.onclick = function () { openPay(l); };
        foot.appendChild(btn);
      }
      card.appendChild(foot);
      out.appendChild(card);
    });

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

  function lookup(name) {
    var btn = $('stGo'); btn.disabled = true; btn.textContent = 'กำลังค้นหา...';
    $('stResult').textContent = '';
    return call('customerLookup', name).then(function (res) {
      btn.disabled = false; btn.textContent = 'ค้นหา';
      if (res.status !== 'Success') { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return; }
      current.name = name; store('_custName', name);
      render(res);
    });
  }

  // ── Slip form ─────────────────────────────────────────────
  function localNow() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
  function openPay(list) {
    current.listId = list.id; current.slip = ''; current.ref = '';
    $('payForm').reset();
    $('payList').textContent = list.name + ' · ' + current.name;
    $('payTime').value = localNow();
    $('payAddress').value = store('stAddress');
    $('paySlipPreview').hidden = true;
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
  // Thai bank slips carry a mini QR: TLV with tag 00 holding the bank's
  // transaction reference in sub-tag 02. Falls back to the raw payload.
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
    var ref = top['00'] ? tlv(top['00'])['02'] : '';
    return (ref || payload).trim().slice(0, 120);
  }
  function readQR(img) {
    return loadJsQR().then(function (jsQR) {
      // Slip QRs are small; try full size first, then smaller copies
      var sizes = [1600, 1000];
      for (var i = 0; i < sizes.length; i++) {
        var c = draw(img, sizes[i]);
        var d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
        var code = jsQR(d.data, d.width, d.height, { inversionAttempts: 'dontInvert' });
        if (code && code.data) return slipRef(code.data);
      }
      return '';
    }).catch(function () { return ''; });
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
        $('payRef').textContent = ref ? 'เลขอ้างอิง ' + ref : 'ไม่พบ QR บนสลิป (ส่งได้ตามปกติ)';
      });
    }).catch(function (e) {
      $('payRef').textContent = '';
      toast(e.message || 'อ่านรูปไม่ได้', 'error');
    }).then(function () { $('paySend').disabled = false; });
  });

  $('payCancel').onclick = function () { $('payDialog').close(); };

  $('payForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!current.slip) { toast('กรุณาแนบรูปสลิป', 'error'); return; }
    var amount = Number($('payAmount').value);
    if (!(amount > 0)) { toast('กรุณากรอกยอดโอน', 'error'); return; }
    var t = $('payTime').value ? new Date($('payTime').value) : null;
    var address = $('payAddress').value.trim();
    var btn = $('paySend'); btn.disabled = true; btn.textContent = 'กำลังส่ง...';
    call('customerSubmitPayment', current.name, current.listId, amount,
      t && !isNaN(t.getTime()) ? t.toISOString() : null, current.ref, address, current.slip)
      .then(function (res) {
        btn.disabled = false; btn.textContent = 'ส่ง';
        if (res.status !== 'Success') { toast(res.message || 'ส่งไม่สำเร็จ', 'error'); return; }
        if (address) store('stAddress', address);
        $('payDialog').close();
        toast('ส่งสลิปเรียบร้อย ขอบคุณค่ะ', 'success');
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
