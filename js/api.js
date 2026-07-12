// ═══════════════════════════════════════════════════════════
// api.js — Supabase backend + google.script.run compatibility shim
//
// Re-implements every server function from the old Apps Script
// code.gs on top of Supabase, and emulates the
//   google.script.run.withSuccessHandler(..).withFailureHandler(..).fn(args)
// call style so the original UI code keeps working unchanged.
// ═══════════════════════════════════════════════════════════
(function () {
  'use strict';

  var PLACEHOLDER_IMG = 'https://www.svgrepo.com/show/508699/landscape-placeholder.svg';

  var CONFIGURED =
    typeof window.SUPABASE_URL === 'string' &&
    window.SUPABASE_URL.indexOf('YOUR_') === -1 &&
    typeof window.SUPABASE_ANON_KEY === 'string' &&
    window.SUPABASE_ANON_KEY.indexOf('YOUR_') === -1;

  var sb = null;
  if (CONFIGURED) {
    sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  } else {
    // Visible hint so a missing config is obvious
    document.addEventListener('DOMContentLoaded', function () {
      var bar = document.createElement('div');
      bar.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:99999;background:#FF4757;color:#fff;' +
        'padding:10px 16px;font-family:sans-serif;font-size:0.85rem;text-align:center;';
      bar.textContent = '⚠️ ยังไม่ได้ตั้งค่า Supabase — กรุณาแก้ไขไฟล์ js/config.js (SUPABASE_URL / SUPABASE_ANON_KEY)';
      document.body.appendChild(bar);
    });
  }
  window.__sb = sb;

  // ── helpers ─────────────────────────────────────────────────
  var NOT_CONFIGURED_MSG = 'ยังไม่ได้ตั้งค่า Supabase — แก้ไขไฟล์ js/config.js ก่อนใช้งานค่ะ';

  function J(o) { return JSON.stringify(o); }
  function ok(extra) {
    var o = { status: 'Success' };
    if (extra) for (var k in extra) o[k] = extra[k];
    return J(o);
  }
  function err(m) { return J({ status: 'Error', message: String(m || 'เกิดข้อผิดพลาด') }); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function numOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v); return isNaN(n) ? null : n;
  }
  function isHidden(display) {
    var d = String(display || '').trim().toLowerCase();
    return d === 'hidden' || d === 'hide' || d === 'false' || d === 'no';
  }
  function randomCode() {
    var s = '';
    for (var i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    return s + '00';
  }

  function requireSb() { if (!sb) throw new Error(NOT_CONFIGURED_MSG); }

  async function getSession() {
    if (!sb) return null;
    var r = await sb.auth.getSession();
    return (r && r.data && r.data.session) || null;
  }

  // Admin functions return the same JSON error string the old
  // backend produced when not authorised.
  async function requireAdmin() {
    var s = await getSession();
    if (!s) throw { __json: err('Unauthorised — กรุณาเข้าสู่ระบบใหม่') };
    return s;
  }

  // rowIndex ↔ database-id maps (the old sheet UI addresses rows by
  // sheet row number; we fabricate stable indexes per fetch)
  var _listRowMap = {};              // rowIndex -> order_lists.id
  var _prodRowMap = {};              // listId -> { rowIndex -> products.id }
  var _stockRowMap = {};             // rowIndex -> stock_items.id

  function listIdFromRow(rowIndex) { return _listRowMap[rowIndex] || null; }

  async function fetchLists() {
    var r = await sb.from('order_lists').select('*').order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchProducts(listId) {
    var r = await sb.from('products').select('*').eq('list_id', listId).order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchOrders(listId) {
    var r = await sb.from('orders').select('*').eq('list_id', listId).order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  // ════════════════════════════════════════════════════════════
  // API — one function per old code.gs server function
  // ════════════════════════════════════════════════════════════
  var API = {

    // ── URLs ──────────────────────────────────────────────────
    getWebAppUrl: async function () {
      return location.origin + location.pathname.replace(/[^\/]*$/, '') + 'index.html';
    },

    // ── Auth ──────────────────────────────────────────────────
    adminVerifyLogin: async function (username, password) {
      if (!sb) return { ok: false, message: NOT_CONFIGURED_MSG };
      username = String(username || '').trim().toLowerCase();
      password = String(password || '').trim();
      if (!username || !password) return { ok: false };
      var r = await sb.auth.signInWithPassword({ email: username, password: password });
      return { ok: !r.error };
    },

    adminSetSessionToken: async function (username, password) {
      if (!sb) return false;
      var s = await getSession();
      if (s) return true;
      if (username && password) {
        var r = await sb.auth.signInWithPassword({
          email: String(username).trim().toLowerCase(),
          password: String(password).trim()
        });
        return !r.error;
      }
      return false;
    },

    getAdminEmail: async function () {
      var s = await getSession();
      return (s && s.user && s.user.email) || '';
    },

    // ── Order lists (public) ─────────────────────────────────
    getOrderLists: async function () {
      requireSb();
      var data = await fetchLists();
      var out = [];
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        if (isHidden(row.display)) continue;
        out.push({
          index: i,
          url: '',
          status: String(row.status || 'Open').trim(),
          name: String(row.name || '').trim() || 'รายการสั่งซื้อ',
          description: String(row.description || '').trim(),
          image: String(row.image || '').trim() || PLACEHOLDER_IMG,
          sheetId: row.id
        });
      }
      return out;
    },

    // ── Products (public) ────────────────────────────────────
    getProductsFromSheet: async function (sheetId) {
      try {
        requireSb();
        var data = await fetchProducts(sheetId);
        var products = data.map(function (r) {
          return {
            id: r.code,
            name: r.name,
            image: r.image ? String(r.image) : PLACEHOLDER_IMG,
            price: num(r.price),
            deposit: num(r.deposit),
            remaining: r.remaining === null || r.remaining === undefined ? null : Number(r.remaining),
            status: r.status || 'Open',
            options: r.options
              ? String(r.options).split(',').map(function (o) { return o.trim(); }).filter(Boolean)
              : []
          };
        });
        return ok({ products: products });
      } catch (e) { return err(e.message || e); }
    },

    // ── Submit order (public, atomic via RPC) ────────────────
    submitOrderToSheet: async function (sheetId, customerName, customerPhone, orderItems) {
      try {
        requireSb();
        if (!orderItems || !orderItems.length) return err('No order items received');
        var r = await sb.rpc('submit_order', {
          p_list_id: sheetId,
          p_customer: String(customerName || ''),
          p_phone: String(customerPhone || ''),
          p_items: orderItems
        });
        if (r.error) return err(r.error.message);
        return J(r.data);
      } catch (e) { return err(e.message || e); }
    },

    // ── Image proxy for receipt rendering (CORS-safe) ────────
    proxyImageAsBase64: async function (url) {
      try {
        if (!url || String(url).indexOf('http') !== 0) return null;
        var resp = null;
        try { resp = await fetch(url, { mode: 'cors' }); } catch (e) { resp = null; }
        if (!resp || !resp.ok) {
          var prox = 'https://images.weserv.nl/?url=' +
            encodeURIComponent(String(url).replace(/^https?:\/\//, ''));
          try { resp = await fetch(prox); } catch (e2) { resp = null; }
        }
        if (!resp || !resp.ok) return null;
        var buf = await resp.arrayBuffer();
        var bytes = new Uint8Array(buf);
        var bin = '';
        var CHUNK = 0x8000;
        for (var i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
      } catch (e) { return null; }
    },

    // ════════════════════════════════════════════════════════
    // ADMIN — order lists
    // ════════════════════════════════════════════════════════
    adminGetOrderLists: async function () {
      try {
        requireSb(); await requireAdmin();
        var data = await fetchLists();
        _listRowMap = {};
        var rows = data.map(function (row, i) {
          var rowIndex = i + 2;
          _listRowMap[rowIndex] = row.id;
          return {
            rowIndex: rowIndex,
            url: '',
            sheetId: row.id,
            name: String(row.name || 'รายการสั่งซื้อ').trim(),
            desc: String(row.description || '').trim(),
            image: String(row.image || '').trim(),
            status: String(row.status || 'Open').trim(),
            display: String(row.display || '').trim()
          };
        });
        return ok({ rows: rows });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminAddOrderList: async function () {
      return err('โหมด "เชื่อมชีต" ใช้ไม่ได้ในเวอร์ชันเว็บ (ไม่มี Google Sheets แล้ว) — กรุณาใช้โหมด "✨ สร้างใหม่" แทนค่ะ');
    },

    adminCreateNewOrderList: async function (name, desc, image, status) {
      try {
        requireSb(); await requireAdmin();
        name = String(name || '').trim();
        if (!name) return err('กรุณากรอกชื่อรายการ');
        var r = await sb.from('order_lists').insert({
          name: name,
          description: String(desc || '').trim(),
          image: String(image || '').trim(),
          status: String(status || 'Open').trim(),
          display: 'Show'
        }).select().single();
        if (r.error) return err(r.error.message);
        return ok({ sheetId: r.data.id, name: name, url: '' });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    refreshOrderListNames: async function () { return ok({ updated: 0 }); },
    adminRefreshOrderListName: async function () { return ok({}); },

    adminToggleStatus: async function (rowIndex) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var cur = await sb.from('order_lists').select('status').eq('id', id).single();
        if (cur.error) return err(cur.error.message);
        var next = String(cur.data.status).trim() === 'Open' ? 'Closed' : 'Open';
        var r = await sb.from('order_lists').update({ status: next }).eq('id', id);
        if (r.error) return err(r.error.message);
        return ok({ newStatus: next });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminToggleDisplay: async function (rowIndex) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var cur = await sb.from('order_lists').select('display').eq('id', id).single();
        if (cur.error) return err(cur.error.message);
        var next = String(cur.data.display || '').trim().toLowerCase() === 'hidden' ? 'Show' : 'Hidden';
        var r = await sb.from('order_lists').update({ display: next }).eq('id', id);
        if (r.error) return err(r.error.message);
        return ok({ newDisplay: next });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminUpdateOrderListRow: async function (rowIndex, desc, image) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var r = await sb.from('order_lists')
          .update({ description: String(desc || ''), image: String(image || '') })
          .eq('id', id);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminDeleteOrderList: async function (rowIndex) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var r = await sb.from('order_lists').delete().eq('id', id);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminCreateOrderList: async function () {
      return API.adminAddOrderList();
    },

    // ════════════════════════════════════════════════════════
    // ADMIN — orders / products
    // ════════════════════════════════════════════════════════
    adminGetOrders: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var data = await fetchOrders(sheetId);
        var orders = data.map(function (r, i) {
          return {
            rowIndex: i + 2,
            timestamp: r.created_at || '',
            customer: r.customer || '',
            product: r.product || '',
            qty: num(r.qty),
            payType: r.pay_type || '',
            price: num(r.price),
            total: num(r.total),
            yuan: num(r.yuan),
            totalYuan: num(r.total_yuan),
            fullPrice: num(r.full_price),
            totalFull: num(r.total_full),
            remark: r.remark || ''
          };
        });
        return ok({ orders: orders });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminGetProducts: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var data = await fetchProducts(sheetId);
        var map = {};
        var products = data.map(function (r, i) {
          var rowIndex = i + 2;
          map[rowIndex] = r.id;
          return {
            rowIndex: rowIndex,
            id: r.code,
            name: r.name,
            image: r.image || '',
            price: num(r.price),
            deposit: num(r.deposit),
            remaining: r.remaining === null || r.remaining === undefined ? null : Number(r.remaining),
            status: r.status || 'Open',
            yuan: num(r.yuan),
            options: r.options ? String(r.options) : ''
          };
        });
        _prodRowMap[sheetId] = map;
        return ok({ products: products });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminCreateProduct: async function (sheetId, id, name, image, price, deposit, remaining, yuan, options) {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('products').insert({
          list_id: sheetId,
          code: String(id || '').trim() || randomCode(),
          name: String(name || ''),
          image: String(image || ''),
          price: num(price),
          deposit: num(deposit),
          remaining: numOrNull(remaining),
          status: 'Open',
          yuan: num(yuan),
          options: String(options || '')
        });
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminUpdateProduct: async function (sheetId, rowIndex, id, name, image, price, deposit, remaining, yuan, options) {
      try {
        requireSb(); await requireAdmin();
        var pid = (_prodRowMap[sheetId] || {})[rowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var r = await sb.from('products').update({
          code: String(id || '').trim(),
          name: String(name || ''),
          image: String(image || ''),
          price: num(price),
          deposit: num(deposit),
          remaining: numOrNull(remaining),
          yuan: num(yuan),
          options: String(options || '')
        }).eq('id', pid);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminUpdateStock: async function (sheetId, productRowIndex, newRemaining) {
      try {
        requireSb(); await requireAdmin();
        var pid = (_prodRowMap[sheetId] || {})[productRowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var r = await sb.from('products').update({ remaining: numOrNull(newRemaining) }).eq('id', pid);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminDeleteProduct: async function (sheetId, productRowIndex) {
      try {
        requireSb(); await requireAdmin();
        var pid = (_prodRowMap[sheetId] || {})[productRowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var r = await sb.from('products').delete().eq('id', pid);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminToggleProductStatus: async function (sheetId, productRowIndex) {
      try {
        requireSb(); await requireAdmin();
        var pid = (_prodRowMap[sheetId] || {})[productRowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var cur = await sb.from('products').select('status').eq('id', pid).single();
        if (cur.error) return err(cur.error.message);
        var next = String(cur.data.status).trim() === 'Open' ? 'Closed' : 'Open';
        var r = await sb.from('products').update({ status: next }).eq('id', pid);
        if (r.error) return err(r.error.message);
        return ok({ newStatus: next });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // ── Customer summary ──────────────────────────────────────
    adminGenerateCustomerSummary: async function (sheetId, customerName, startDate, endDate) {
      try {
        requireSb(); await requireAdmin();
        var data = await fetchOrders(sheetId);
        var start = startDate ? new Date(startDate) : null;
        if (start) start.setHours(0, 0, 0, 0);
        var end = endDate ? new Date(endDate) : null;
        if (end) end.setHours(23, 59, 59, 999);

        var target = String(customerName || '').trim();
        var customerOrders = data.filter(function (r) {
          if (String(r.customer || '').trim() !== target) return false;
          if (start || end) {
            var d = new Date(r.created_at);
            if (!isNaN(d.getTime())) {
              if (start && d < start) return false;
              if (end && d > end) return false;
            }
          }
          return true;
        });

        if (!customerOrders.length) return err('ไม่พบรายการสั่งซื้อในช่วงวันที่เลือก');

        var totalFull = 0, totalDeposit = 0, totalYuan = 0, lines = [];
        customerOrders.forEach(function (r, idx) {
          totalFull += num(r.total_full);
          totalDeposit += num(r.total);
          totalYuan += num(r.total_yuan);
          lines.push((idx + 1) + '. ' + r.product + ' (' + num(r.full_price) + ' x ' + (num(r.qty) || 1) + ')');
        });

        return ok({
          customerName: customerName,
          orderLines: lines,
          totalFull: totalFull,
          totalDeposit: totalDeposit,
          totalYuan: totalYuan,
          remaining: totalFull - totalDeposit
        });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // ── Image upload (Cloudinary, direct from browser) ───────
    adminUploadImage: async function (base64Image) {
      try {
        var fd = new FormData();
        fd.append('file', base64Image);
        fd.append('upload_preset', window.CLOUDINARY_UPLOAD_PRESET);
        var resp = await fetch(
          'https://api.cloudinary.com/v1_1/' + window.CLOUDINARY_CLOUD_NAME + '/image/upload',
          { method: 'POST', body: fd }
        );
        var json = await resp.json();
        if (!json.secure_url) return err(json.error ? json.error.message : 'Upload failed');
        return ok({ url: json.secure_url });
      } catch (e) { return err(e.message || e); }
    },

    // ════════════════════════════════════════════════════════
    // RESTOCK NOTIFY
    // ════════════════════════════════════════════════════════
    adminGetNotifyEmails: async function () {
      try {
        requireSb();
        var s = await requireAdmin();
        var emails = [];
        if (s.user && s.user.email) emails.push(s.user.email.toLowerCase());
        var r = await sb.from('notify_emails').select('email');
        if (!r.error && r.data) {
          r.data.forEach(function (row) {
            var e2 = String(row.email || '').trim().toLowerCase();
            if (e2 && e2.indexOf('@') !== -1 && emails.indexOf(e2) === -1) emails.push(e2);
          });
        }
        return ok({ emails: emails });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Aggregates orders per product (replaces the old "Summary Order"
    // sheet which was computed by spreadsheet formulas)
    adminGetSummaryOrder: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var data = await fetchOrders(sheetId);
        var byName = {}, orderKeys = [];
        data.forEach(function (r) {
          var name = String(r.product || '').trim();
          if (!name) return;
          if (!byName[name]) {
            byName[name] = { name: name, qty: 0, priceYuan: 0, totalYuan: 0, priceTHB: 0, totalTHB: 0 };
            orderKeys.push(name);
          }
          var g = byName[name];
          g.qty += num(r.qty);
          g.totalYuan += num(r.total_yuan);
          g.totalTHB += num(r.total_full);
          if (num(r.yuan)) g.priceYuan = num(r.yuan);
          if (num(r.full_price)) g.priceTHB = num(r.full_price);
        });
        var rows = orderKeys.map(function (k) { return byName[k]; });
        return ok({ rows: rows });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Web version: opens the user's e-mail client (mailto:) with the
    // restock summary, and a Google Calendar event template.
    // (Browsers cannot send e-mail silently — see README.)
    adminSendRestockNotify: async function (sheetId, shopName, buyDate, note, toEmails, addCalendar) {
      try {
        requireSb(); await requireAdmin();
        var sumJson = JSON.parse(await API.adminGetSummaryOrder(sheetId));
        if (sumJson.status !== 'Success') return err(sumJson.message || 'โหลดข้อมูลไม่สำเร็จ');

        var items = (sumJson.rows || []).filter(function (r) { return r.name && r.qty > 0; });
        var grandTotalYuan = 0, grandTotalTHB = 0;
        items.forEach(function (it) { grandTotalYuan += it.totalYuan; grandTotalTHB += it.totalTHB; });

        var d = new Date(buyDate);
        var dateStr = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });

        var lines = items.map(function (it, i) {
          return (i + 1) + '. ' + it.name + ' x' + it.qty +
            '  (¥' + it.priceYuan + ' / ฿' + it.priceTHB.toLocaleString() + ')' +
            '  รวม ¥' + it.totalYuan + ' / ฿' + it.totalTHB.toLocaleString();
        });

        var body =
          '🛒 แจ้งเตือนสั่งของ: ' + shopName + '\n' +
          'ต้องซื้อวันที่ ' + dateStr + '\n\n' +
          (note ? '📝 ' + note + '\n\n' : '') +
          lines.join('\n') + '\n\n' +
          'รวมทั้งหมด: ¥' + grandTotalYuan + ' / ฿' + grandTotalTHB.toLocaleString() + '\n\n' +
          'ส่งจากระบบ Order Hub Admin • ' + new Date().toLocaleString('th-TH');

        var subject = '🛒 สั่งของ: ' + shopName + ' — ' + dateStr;
        var mailto = 'mailto:' + toEmails.join(',') +
          '?subject=' + encodeURIComponent(subject) +
          '&body=' + encodeURIComponent(body);
        window.open(mailto, '_blank');

        if (addCalendar) {
          if (!toEmails || !toEmails.length) return err('กรุณาเลือกอีเมลผู้เข้าร่วมก่อนเพิ่มลงปฏิทิน');
          function ymd(dt) {
            return dt.getFullYear() +
              String(dt.getMonth() + 1).padStart(2, '0') +
              String(dt.getDate()).padStart(2, '0');
          }
          var dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 1);
          var desc = 'สั่งของ: ' + shopName + '\n\nรายการ:\n' +
            items.map(function (it) { return '• ' + it.name + ' x' + it.qty + ' (฿' + it.totalTHB + ')'; }).join('\n') +
            '\n\nรวม: ¥' + grandTotalYuan + ' / ฿' + grandTotalTHB +
            (note ? '\n\n📝 ' + note : '');
          var calUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
            '&text=' + encodeURIComponent('🛒 สั่งของ — ' + shopName) +
            '&dates=' + ymd(d) + '/' + ymd(dEnd) +
            '&details=' + encodeURIComponent(desc) +
            '&add=' + encodeURIComponent(toEmails.join(','));
          window.open(calUrl, '_blank');
        }

        return ok({ sent: toEmails.length, calendar: !!addCalendar });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // ════════════════════════════════════════════════════════
    // STOCK / WAREHOUSE
    // ════════════════════════════════════════════════════════
    adminGetStockProducts: async function () {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('stock_items').select('*').order('seq', { ascending: true });
        if (r.error) return err(r.error.message);
        var data = r.data || [];

        var parents = data.filter(function (x) { return !x.parent_id; });
        var childrenByParent = {};
        data.forEach(function (x) {
          if (x.parent_id) {
            (childrenByParent[x.parent_id] = childrenByParent[x.parent_id] || []).push(x);
          }
        });

        _stockRowMap = {};
        var nextRow = 2;
        var products = parents.map(function (p) {
          var pRow = nextRow++;
          _stockRowMap[pRow] = p.id;
          var kids = (childrenByParent[p.id] || []).map(function (c) {
            var cRow = nextRow++;
            _stockRowMap[cRow] = c.id;
            return {
              rowIndex: cRow,
              id: c.code || '',
              name: c.name || '',
              image: c.image || '',
              stock: c.stock === null || c.stock === undefined ? null : Number(c.stock)
            };
          });
          return {
            rowIndex: pRow,
            id: p.code || '',
            name: p.name || '',
            image: p.image || '',
            price: num(p.price),
            deposit: num(p.deposit),
            yuan: num(p.yuan),
            stock: p.stock === null || p.stock === undefined ? null : Number(p.stock),
            status: p.status || 'Open',
            children: kids
          };
        });
        return ok({ products: products });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminCreateStockProduct: async function (product, opts) {
      try {
        requireSb(); await requireAdmin();
        var pr = num(product.price), dep = num(product.deposit), yu = num(product.yuan);
        var st = product.status || 'Open';

        if (!opts || !opts.length) {
          var r1 = await sb.from('stock_items').insert({
            parent_id: null,
            code: String(product.id || ''),
            name: String(product.name || ''),
            image: String(product.image || ''),
            price: pr, deposit: dep, yuan: yu,
            stock: numOrNull(product.stock),
            status: st
          });
          if (r1.error) return err(r1.error.message);
        } else {
          var rp = await sb.from('stock_items').insert({
            parent_id: null,
            code: '',
            name: String(product.name || ''),
            image: String(product.image || ''),
            price: pr, deposit: dep, yuan: yu,
            stock: null,
            status: st
          }).select().single();
          if (rp.error) return err(rp.error.message);
          var kidRows = opts.map(function (o) {
            return {
              parent_id: rp.data.id,
              code: String(o.id || ''),
              name: String(o.name || ''),
              image: String(o.image || ''),
              price: pr, deposit: dep, yuan: yu,
              stock: numOrNull(o.stock),
              status: st
            };
          });
          var rc = await sb.from('stock_items').insert(kidRows);
          if (rc.error) return err(rc.error.message);
        }
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminUpdateStockRow: async function (rowIndex, isChild, id, name, image, price, deposit, yuan, stock, status) {
      try {
        requireSb(); await requireAdmin();
        var sid = _stockRowMap[rowIndex];
        if (!sid) return err('ไม่พบสินค้าในคลัง (กรุณารีเฟรช)');
        var r = await sb.from('stock_items').update({
          code: String(id || ''),
          name: String(name || ''),
          image: String(image || ''),
          price: num(price), deposit: num(deposit), yuan: num(yuan),
          stock: numOrNull(stock),
          status: status || 'Open'
        }).eq('id', sid);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminAppendStockChild: async function (parentRowIndex, childObj) {
      try {
        requireSb(); await requireAdmin();
        var pid = _stockRowMap[parentRowIndex];
        if (!pid) return err('ไม่พบสินค้าหลัก (กรุณารีเฟรช)');
        var pr = await sb.from('stock_items').select('*').eq('id', pid).single();
        if (pr.error) return err(pr.error.message);
        var p = pr.data;
        var r = await sb.from('stock_items').insert({
          parent_id: pid,
          code: String(childObj.id || ''),
          name: String(childObj.name || ''),
          image: String(childObj.image || ''),
          price: num(p.price), deposit: num(p.deposit), yuan: num(p.yuan),
          stock: numOrNull(childObj.stock),
          status: p.status || 'Open'
        });
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminDeleteStockProduct: async function (parentRowIndex, childRowIndexes) {
      try {
        requireSb(); await requireAdmin();
        var pid = _stockRowMap[parentRowIndex];
        if (!pid) return err('ไม่พบสินค้าในคลัง (กรุณารีเฟรช)');
        // Children are removed automatically (ON DELETE CASCADE)
        var r = await sb.from('stock_items').delete().eq('id', pid);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminPushStockToShop: async function (targetSheetId, items) {
      try {
        requireSb(); await requireAdmin();
        var rows = [];
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var pid = _stockRowMap[item.parentRowIndex];
          if (!pid) continue;
          var pr = await sb.from('stock_items').select('*').eq('id', pid).single();
          if (pr.error || !pr.data || !pr.data.name) continue;
          var p = pr.data;

          var kidIds = (item.childRowIndexes || [])
            .map(function (ri) { return _stockRowMap[ri]; })
            .filter(Boolean);
          var kids = [];
          if (kidIds.length) {
            var kr = await sb.from('stock_items').select('*').in('id', kidIds).order('seq');
            if (!kr.error && kr.data) kids = kr.data.filter(function (k) { return k.name; });
          }

          if (!kids.length) {
            rows.push({
              list_id: targetSheetId,
              code: p.code || randomCode(),
              name: p.name, image: p.image || '',
              price: num(p.price), deposit: num(p.deposit),
              remaining: item.qty || 1,
              status: p.status || 'Open',
              yuan: num(p.yuan),
              options: ''
            });
          } else {
            var optStr = kids.map(function (k) {
              return (k.name || '') + ':' + (k.code || '');
            }).join(',');
            rows.push({
              list_id: targetSheetId,
              code: randomCode(),
              name: p.name, image: p.image || '',
              price: num(p.price), deposit: num(p.deposit),
              remaining: null,
              status: p.status || 'Open',
              yuan: num(p.yuan),
              options: optStr
            });
          }
        }
        if (!rows.length) return err('ไม่มีสินค้าที่นำเข้าได้');
        var r = await sb.from('products').insert(rows);
        if (r.error) return err(r.error.message);
        return ok({ pushed: rows.length });
      } catch (e) { return e.__json || err(e.message || e); }
    }
  };

  window.__api = API;
  window.__sbSignOut = function () { return sb ? sb.auth.signOut() : Promise.resolve(); };

  // ════════════════════════════════════════════════════════════
  // google.script.run emulation
  // ════════════════════════════════════════════════════════════
  function makeRunner() {
    var onSuccess = null, onFailure = null;
    var chain = {};
    var proxy = new Proxy(chain, {
      get: function (t, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { onSuccess = fn; return proxy; };
        if (prop === 'withFailureHandler') return function (fn) { onFailure = fn; return proxy; };
        if (prop === 'withUserObject') return function () { return proxy; };
        if (typeof prop !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          Promise.resolve()
            .then(function () {
              var fn = API[prop];
              if (!fn) throw new Error('Unknown server function: ' + prop);
              return fn.apply(API, args);
            })
            .then(function (res) {
              if (onSuccess) { try { onSuccess(res); } catch (e) { console.error(e); } }
            })
            .catch(function (e) {
              console.error('[api] ' + prop + ':', e);
              if (onFailure) { try { onFailure(e); } catch (e2) { console.error(e2); } }
            });
        };
      }
    });
    return proxy;
  }

  window.google = window.google || {};
  window.google.script = {
    run: new Proxy({}, {
      get: function (t, prop) { return makeRunner()[prop]; }
    }),
    host: { close: function () {} }
  };
})();
