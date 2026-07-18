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
  var _adminVerified = false;
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

  function spreadsheetIdFromUrl(url) {
    var m = String(url || '').match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : '';
  }

  function headerKey(value) {
    return String(value || '').trim().toLowerCase()
      .replace(/[._\-\/\\]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function columnFinder(header) {
    var normalized = header.map(headerKey);
    return function (aliases, fallback) {
      for (var i = 0; i < aliases.length; i++) {
        var idx = normalized.indexOf(headerKey(aliases[i]));
        if (idx !== -1) return idx;
      }
      return fallback;
    };
  }

  function cell(row, idx) {
    return idx >= 0 && idx < row.length ? String(row[idx] || '').trim() : '';
  }

  function legacyNumber(value, rowLabel, allowNull) {
    value = String(value === null || value === undefined ? '' : value).trim();
    if (value === '' && allowNull) return null;
    var cleaned = value.replace(/[,฿¥\s]/g, '');
    var n = Number(cleaned || 0);
    if (!isFinite(n) || n < 0) throw new Error(rowLabel + ': ตัวเลขไม่ถูกต้อง ("' + value + '")');
    return n;
  }

  function legacyDate(value) {
    value = String(value || '').trim();
    if (!value) return null;
    var gv = value.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})(?:,(\d{1,2}),(\d{1,2}),(\d{1,2}))?\)$/);
    if (gv) {
      return gv[1] + '-' + String(Number(gv[2]) + 1).padStart(2, '0') + '-' +
        String(Number(gv[3])).padStart(2, '0') + 'T' +
        String(Number(gv[4] || 0)).padStart(2, '0') + ':' +
        String(Number(gv[5] || 0)).padStart(2, '0') + ':' +
        String(Number(gv[6] || 0)).padStart(2, '0') + '+07:00';
    }
    var m = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      var year = Number(m[3]);
      if (year > 2400) year -= 543;
      return year + '-' + String(Number(m[2])).padStart(2, '0') + '-' +
        String(Number(m[1])).padStart(2, '0') + 'T' +
        String(Number(m[4] || 0)).padStart(2, '0') + ':' +
        String(Number(m[5] || 0)).padStart(2, '0') + ':' +
        String(Number(m[6] || 0)).padStart(2, '0') + '+07:00';
    }
    var parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function googleSheetsApiKey() {
    var key = String(window.GOOGLE_SHEETS_API_KEY || '').trim();
    if (!key || key.indexOf('YOUR_') !== -1) {
      throw new Error('ยังไม่ได้ตั้งค่า Google Sheets API key — กรุณาใส่ GOOGLE_SHEETS_API_KEY ใน js/config.js');
    }
    return key;
  }

  async function googleSheetsRequest(path, params) {
    params = params || [];
    params.push(['key', googleSheetsApiKey()]);
    var query = params.map(function (pair) {
      return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
    }).join('&');
    var response;
    try {
      response = await fetch('https://sheets.googleapis.com/v4/' + path + '?' + query, { credentials: 'omit' });
    } catch (e) {
      throw new Error('เชื่อมต่อ Google Sheets API ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตและข้อจำกัด API key');
    }
    var payload = null;
    try { payload = await response.json(); } catch (e2) { payload = null; }
    if (!response.ok) {
      var message = payload && payload.error && payload.error.message;
      if (response.status === 403) {
        message = 'Google Sheets API ปฏิเสธคำขอ — ตรวจสอบว่าเปิด API, จำกัด key ให้ตรงโดเมน และแชร์ชีตเป็น “ทุกคนที่มีลิงก์ดูได้”';
      } else if (response.status === 404) {
        message = 'ไม่พบ Spreadsheet หรือบัญชีนี้ไม่มีสิทธิ์ดู';
      }
      throw new Error(message || ('Google Sheets API error ' + response.status));
    }
    return payload || {};
  }

  async function fetchGoogleSpreadsheet(spreadsheetId) {
    var encodedId = encodeURIComponent(spreadsheetId);
    var responses = await Promise.all([
      googleSheetsRequest('spreadsheets/' + encodedId, [
        ['fields', 'properties.title,sheets.properties.title']
      ]),
      googleSheetsRequest('spreadsheets/' + encodedId + '/values:batchGet', [
        ['ranges', 'Products'],
        ['ranges', 'Orders'],
        ['majorDimension', 'ROWS'],
        ['valueRenderOption', 'FORMATTED_VALUE']
      ])
    ]);
    var metadata = responses[0], values = responses[1];
    var titles = (metadata.sheets || []).map(function (sheet) {
      return sheet && sheet.properties ? sheet.properties.title : '';
    });
    if (titles.indexOf('Products') === -1 || titles.indexOf('Orders') === -1) {
      throw new Error('Spreadsheet ต้องมีแท็บชื่อ Products และ Orders (ตัวพิมพ์ต้องตรงกัน)');
    }
    var valueRanges = values.valueRanges || [];
    return {
      title: String(metadata.properties && metadata.properties.title || '').trim(),
      products: valueRanges[0] && valueRanges[0].values ? valueRanges[0].values : [],
      orders: valueRanges[1] && valueRanges[1].values ? valueRanges[1].values : []
    };
  }

  function legacyProducts(rows) {
    if (!rows.length) throw new Error('ชีต Products ว่างเปล่า');
    var find = columnFinder(rows[0]);
    var c = {
      code: find(['id', 'product id', 'code', 'barcode', 'รหัส', 'รหัสสินค้า'], 0),
      name: find(['name', 'product', 'product name', 'สินค้า', 'ชื่อสินค้า'], 1),
      image: find(['image', 'image url', 'รูป', 'รูปภาพ'], 2),
      price: find(['price', 'full price', 'ราคา', 'ราคาเต็ม'], 3),
      deposit: find(['deposit', 'มัดจำ'], 4),
      remaining: find(['remaining', 'stock', 'คงเหลือ', 'จำนวนคงเหลือ'], 5),
      status: find(['status', 'สถานะ'], 6),
      yuan: find(['yuan', 'price yuan', 'หยวน', 'ราคาหยวน'], 7),
      options: find(['options', 'option', 'ตัวเลือก'], 8)
    };
    var out = [], seen = {};
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i], name = cell(row, c.name);
      if (!name) continue;
      var code = cell(row, c.code) || ('legacy-' + (i + 1));
      if (seen[code]) throw new Error('Products แถว ' + (i + 1) + ': รหัสสินค้าซ้ำ ' + code);
      seen[code] = true;
      out.push({
        code: code, name: name, image: cell(row, c.image),
        price: legacyNumber(cell(row, c.price), 'Products แถว ' + (i + 1), false),
        deposit: legacyNumber(cell(row, c.deposit), 'Products แถว ' + (i + 1), false),
        remaining: legacyNumber(cell(row, c.remaining), 'Products แถว ' + (i + 1), true),
        status: cell(row, c.status) || 'Open',
        yuan: legacyNumber(cell(row, c.yuan), 'Products แถว ' + (i + 1), false),
        options: cell(row, c.options)
      });
    }
    return out;
  }

  function legacyOrders(rows) {
    if (!rows.length) return [];
    var find = columnFinder(rows[0]);
    var c = {
      timestamp: find(['timestamp', 'date', 'วันที่', 'วันเวลา'], 0),
      customer: find(['customer', 'customer name', 'ลูกค้า', 'ชื่อลูกค้า'], 1),
      product: find(['product', 'product name', 'สินค้า', 'ชื่อสินค้า'], 2),
      qty: find(['qty', 'quantity', 'จำนวน'], 3),
      payType: find(['pay type', 'payment type', 'ประเภทการชำระ', 'ประเภท'], 4),
      price: find(['price', 'ราคา'], 5), total: find(['total', 'รวม'], 6),
      yuan: find(['yuan', 'หยวน'], 7), totalYuan: find(['total yuan', 'รวมหยวน'], 8),
      fullPrice: find(['full price', 'ราคาเต็ม'], 9), totalFull: find(['total full', 'รวมราคาเต็ม'], 10),
      remark: find(['remark', 'phone', 'หมายเหตุ', 'เบอร์', 'เบอร์โทร'], 11)
    };
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i], customer = cell(row, c.customer), product = cell(row, c.product);
      if (!customer && !product) continue;
      var imported = {
        customer: customer, product: product,
        qty: legacyNumber(cell(row, c.qty) || '1', 'Orders แถว ' + (i + 1), false),
        pay_type: cell(row, c.payType) || 'Full Price',
        price: legacyNumber(cell(row, c.price), 'Orders แถว ' + (i + 1), false),
        total: legacyNumber(cell(row, c.total), 'Orders แถว ' + (i + 1), false),
        yuan: legacyNumber(cell(row, c.yuan), 'Orders แถว ' + (i + 1), false),
        total_yuan: legacyNumber(cell(row, c.totalYuan), 'Orders แถว ' + (i + 1), false),
        full_price: legacyNumber(cell(row, c.fullPrice), 'Orders แถว ' + (i + 1), false),
        total_full: legacyNumber(cell(row, c.totalFull), 'Orders แถว ' + (i + 1), false),
        remark: cell(row, c.remark)
      };
      var created = legacyDate(cell(row, c.timestamp));
      if (created) imported.created_at = created;
      out.push(imported);
    }
    return out;
  }

  function requireSb() { if (!sb) throw new Error(NOT_CONFIGURED_MSG); }

  // "admin" → "admin@orderhub.local"; real e-mail addresses pass through
  function toAdminEmail(username) {
    username = String(username || '').trim().toLowerCase();
    if (username && username.indexOf('@') === -1) {
      username += (window.ADMIN_USERNAME_DOMAIN || '@orderhub.local');
    }
    return username;
  }

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
    if (!_adminVerified) {
      var check = await sb.rpc('is_admin');
      if (check.error || check.data !== true) {
        throw { __json: err('Forbidden — บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ') };
      }
      _adminVerified = true;
    }
    return s;
  }

  // rowIndex ↔ database-id maps (the old sheet UI addresses rows by
  // sheet row number; we fabricate stable indexes per fetch)
  var _listRowMap = {};              // rowIndex -> order_lists.id
  var _prodRowMap = {};              // listId -> { rowIndex -> products.id }
  var _stockRowMap = {};             // rowIndex -> stock_items.id

  function listIdFromRow(rowIndex) { return _listRowMap[rowIndex] || null; }

  async function fetchLists() {
    var r = await sb.from('order_lists')
      .select('id,seq,name,description,image,status,display,source_spreadsheet_id,created_at')
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchProducts(listId) {
    var r = await sb.from('products')
      .select('id,seq,list_id,code,name,image,price,deposit,remaining,status,yuan,options,source_stock_item_id')
      .eq('list_id', listId)
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchOrders(listId) {
    var r = await sb.from('orders')
      .select('id,seq,list_id,customer,product,qty,pay_type,price,total,yuan,total_yuan,full_price,total_full,remark,created_at')
      .eq('list_id', listId)
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  function mapOrder(r) {
    return {
      rowIndex: r.seq,
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
    // Plain usernames are allowed: "admin" becomes the Supabase user
    // "admin@orderhub.local" (domain configurable in config.js)
    adminVerifyLogin: async function (username, password) {
      if (!sb) return { ok: false, message: NOT_CONFIGURED_MSG };
      username = toAdminEmail(username);
      password = String(password || '').trim();
      if (!username || !password) return { ok: false };
      var r = await sb.auth.signInWithPassword({ email: username, password: password });
      if (r.error) return { ok: false };
      var adminCheck = await sb.rpc('is_admin');
      if (adminCheck.error || adminCheck.data !== true) {
        await sb.auth.signOut();
        return { ok: false, message: 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแลระบบ' };
      }
      _adminVerified = true;
      return { ok: true };
    },

    // Legacy shim kept for compatibility — reports whether a Supabase
    // session exists. Passwords are never accepted here (they used to
    // ride along in POS URLs, which is unsafe).
    adminSetSessionToken: async function () {
      if (!sb) return false;
      var s = await getSession();
      return !!s;
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
    submitOrderToSheet: async function (sheetId, customerName, customerPhone, orderItems, checkoutId) {
      try {
        requireSb();
        if (!orderItems || !orderItems.length) return err('No order items received');
        var params = {
          p_list_id: sheetId,
          p_customer: String(customerName || ''),
          p_phone: String(customerPhone || ''),
          p_items: orderItems
        };
        // checkout id makes retries idempotent (no duplicate orders)
        if (checkoutId) params.p_checkout_id = checkoutId;
        var r = await sb.rpc('submit_order', params);
        if (r.error && r.error.code === 'PGRST202' && params.p_checkout_id) {
          // Database not migrated yet (old 4-arg signature) — degrade
          // gracefully so customer checkout never breaks.
          delete params.p_checkout_id;
          r = await sb.rpc('submit_order', params);
        }
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
          var sourceId = String(row.source_spreadsheet_id || '').trim();
          return {
            rowIndex: rowIndex,
            url: sourceId ? 'https://docs.google.com/spreadsheets/d/' + sourceId + '/edit' : '',
            sheetId: row.id,
            sourceSpreadsheetId: sourceId,
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

    adminAddOrderList: async function (spreadsheetUrl, status, desc, image, display) {
      try {
        requireSb(); await requireAdmin();
        var spreadsheetId = spreadsheetIdFromUrl(spreadsheetUrl);
        if (!spreadsheetId) return err('URL Google Spreadsheet ไม่ถูกต้อง');
        var spreadsheet = await fetchGoogleSpreadsheet(spreadsheetId);
        var importName = spreadsheet.title;
        if (!importName) return err('Google Sheets API ไม่ได้ส่งชื่อ Spreadsheet กลับมา');
        var products = legacyProducts(spreadsheet.products);
        var orders = legacyOrders(spreadsheet.orders);
        var imported = await sb.rpc('import_legacy_order_list', {
          p_name: importName,
          p_description: String(desc || '').trim(),
          p_image: String(image || '').trim(),
          p_status: String(status || 'Closed').trim(),
          p_display: String(display || 'Show').trim(),
          p_products: products,
          p_orders: orders
        });
        if (imported.error) {
          var importError = String(imported.error.message || '');
          if (imported.error.code === 'PGRST202' || importError.indexOf('import_legacy_order_list') !== -1) {
            return err('Supabase ยังไม่ได้ติดตั้งฟังก์ชันนำเข้า — เปิด SQL Editor แล้วรันไฟล์ supabase/schema.sql เวอร์ชันล่าสุดทั้งหมด จากนั้นลองใหม่');
          }
          throw imported.error;
        }
        // Remember the source sheet so products can be re-synced later.
        // Non-fatal: on an older schema (missing column) the sync button
        // simply will not appear for this list.
        var newListId = imported.data && imported.data.sheetId;
        if (newListId) {
          var saved = await sb.from('order_lists')
            .update({ source_spreadsheet_id: spreadsheetId })
            .eq('id', newListId);
          if (saved.error) console.warn('[api] could not save source spreadsheet id:', saved.error.message);
        }
        return J(imported.data);
      } catch (e) {
        return e.__json || err(e.message || e);
      }
    },

    // Re-reads the Products tab of the list's source spreadsheet.
    // Matches by product code: updates existing rows, inserts new ones.
    // Never deletes web products that disappeared from the sheet.
    // Stock (remaining) is only overwritten when updateStock is true,
    // because the web deducts stock in Supabase as customers order.
    adminSyncProductsFromSheet: async function (rowIndex, updateStock) {
      try {
        requireSb(); await requireAdmin();
        var listId = listIdFromRow(rowIndex);
        if (!listId) return err('ไม่พบรายการ (กรุณารีเฟรชหน้า)');

        var lr = await sb.from('order_lists').select('source_spreadsheet_id').eq('id', listId).single();
        if (lr.error) return err(lr.error.message);
        var spreadsheetId = String(lr.data.source_spreadsheet_id || '').trim();
        if (!spreadsheetId) return err('รายการนี้ไม่ได้นำเข้าจาก Google Sheets จึงซิงก์ไม่ได้');

        var spreadsheet = await fetchGoogleSpreadsheet(spreadsheetId);
        var sheetProducts = legacyProducts(spreadsheet.products);

        var existing = await fetchProducts(listId);
        var byCode = {};
        existing.forEach(function (p) { byCode[String(p.code || '').trim()] = p; });

        function normStatus(s) {
          var v = String(s || '').trim().toLowerCase();
          return (v === 'closed' || v === 'close' || v === 'ปิด') ? 'Closed' : 'Open';
        }
        function normRemaining(v) {
          return v === null || v === undefined || v === '' ? null : Number(v);
        }

        var inserts = [], updates = [];
        sheetProducts.forEach(function (sp) {
          var row = {
            list_id: listId,
            code: sp.code,
            name: sp.name,
            image: String(sp.image || ''),
            price: num(sp.price),
            deposit: num(sp.deposit),
            yuan: num(sp.yuan),
            options: String(sp.options || ''),
            status: normStatus(sp.status)
          };
          var cur = byCode[String(sp.code || '').trim()];
          if (!cur) {
            row.remaining = normRemaining(sp.remaining);
            inserts.push(row);
          } else {
            row.id = cur.id;
            if (updateStock) row.remaining = normRemaining(sp.remaining);
            updates.push(row);
          }
        });

        if (inserts.length) {
          var ri = await sb.from('products').insert(inserts);
          if (ri.error) return err(ri.error.message);
        }
        if (updates.length) {
          var ru = await sb.from('products').upsert(updates, { onConflict: 'id' });
          if (ru.error) return err(ru.error.message);
        }
        return ok({ updated: updates.length, added: inserts.length, total: sheetProducts.length });
      } catch (e) { return e.__json || err(e.message || e); }
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
        var orders = data.map(mapOrder);
        return ok({ orders: orders });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Records an in-person POS sale through the atomic submit_pos_sale
    // RPC (validates stock, deducts, inserts order rows in one
    // transaction). items: [{ id, quantity, selectedOption }]
    adminSubmitPosSale: async function (sheetId, items, checkoutId) {
      try {
        requireSb(); await requireAdmin();
        if (!items || !items.length) return err('ไม่มีสินค้าในตะกร้า');
        var params = { p_list_id: sheetId, p_items: items };
        if (checkoutId) params.p_checkout_id = checkoutId;
        var r = await sb.rpc('submit_pos_sale', params);
        if (r.error && r.error.code === 'PGRST202' && params.p_checkout_id) {
          // Old 2-arg signature still installed — retry without the id
          delete params.p_checkout_id;
          r = await sb.rpc('submit_pos_sale', params);
        }
        if (r.error) {
          var msg = String(r.error.message || '');
          if (r.error.code === 'PGRST202' || msg.indexOf('submit_pos_sale') !== -1) {
            return err('Supabase ยังไม่ได้ติดตั้งฟังก์ชันบันทึกการขาย POS — เปิด SQL Editor แล้วรันไฟล์ supabase/schema.sql เวอร์ชันล่าสุดทั้งหมด แล้วลองใหม่');
          }
          return err(msg);
        }
        return J(r.data);
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Full data export for backups — the Supabase free tier has no
    // point-in-time recovery, so this download is the shop's safety net.
    adminExportAllData: async function () {
      try {
        requireSb(); await requireAdmin();
        async function fetchAll(table) {
          var out = [], from = 0, page = 1000;
          while (true) {
            var r = await sb.from(table).select('*')
              .order('seq', { ascending: true })
              .range(from, from + page - 1);
            if (r.error) throw new Error(table + ': ' + r.error.message);
            out = out.concat(r.data || []);
            if (!r.data || r.data.length < page) break;
            from += page;
            if (from >= 100000) break;
          }
          return out;
        }
        var results = await Promise.all([
          fetchAll('order_lists'),
          fetchAll('products'),
          fetchAll('orders'),
          fetchAll('stock_items'),
          sb.from('notify_emails').select('*')
        ]);
        return ok({
          exportedAt: new Date().toISOString(),
          data: {
            order_lists: results[0],
            products: results[1],
            orders: results[2],
            stock_items: results[3],
            notify_emails: results[4].error ? [] : (results[4].data || [])
          }
        });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Distinct customer names for one list — the summary dropdown only
    // needs names, not full order payloads.
    adminGetCustomers: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('orders').select('customer').eq('list_id', sheetId);
        if (r.error) return err(r.error.message);
        var seen = {};
        (r.data || []).forEach(function (row) {
          var name = String(row.customer || '').trim();
          if (name) seen[name] = true;
        });
        return ok({ customers: Object.keys(seen).sort() });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminGetAllOrders: async function () {
      try {
        requireSb(); await requireAdmin();
        var data = [], from = 0, pageSize = 1000, truncated = false;
        while (true) {
          var r = await sb.from('orders')
            .select('id,seq,list_id,customer,product,qty,pay_type,price,total,yuan,total_yuan,full_price,total_full,remark,created_at,order_lists(name)')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);
          if (r.error) return err(r.error.message);
          data = data.concat(r.data || []);
          if (!r.data || r.data.length < pageSize) break;
          from += pageSize;
          if (from >= 10000) { truncated = true; break; }
        }
        var orders = data.map(function (row) {
          var out = mapOrder(row);
          out.shopName = row.order_lists && row.order_lists.name ? row.order_lists.name : '';
          return out;
        });
        return ok({ orders: orders, truncated: truncated });
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
            options: r.options ? String(r.options) : '',
            sourceStockItemId: r.source_stock_item_id || ''
          };
        });
        _prodRowMap[sheetId] = map;
        return ok({ products: products });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Moves a linked product's unsold units back into the warehouse
    // (reverse of "push"): product remaining -> 0, warehouse stock += N.
    adminReturnProductStock: async function (sheetId, productRowIndex) {
      try {
        requireSb(); await requireAdmin();
        var pid = (_prodRowMap[sheetId] || {})[productRowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');

        var pr = await sb.from('products')
          .select('id,name,remaining,source_stock_item_id')
          .eq('id', pid).single();
        if (pr.error) return err(pr.error.message);
        var p = pr.data;
        if (!p.source_stock_item_id) return err('สินค้านี้ไม่ได้ลิงก์กับคลัง จึงคืนสต็อกไม่ได้');
        if (p.remaining === null || p.remaining === undefined) return err('สินค้านี้ไม่จำกัดจำนวน ไม่มีสต็อกให้คืน');
        var qty = Number(p.remaining);
        if (!(qty > 0)) return err('ไม่มีสต็อกเหลือให้คืนค่ะ');

        var sr = await sb.from('stock_items').select('id,stock').eq('id', p.source_stock_item_id).single();
        if (sr.error) return err('ไม่พบสินค้าในคลัง: ' + sr.error.message);

        // Zero the list stock first so a mid-way failure can only
        // under-count the warehouse, never double-count sellable stock
        var u1 = await sb.from('products').update({ remaining: 0 }).eq('id', pid);
        if (u1.error) return err(u1.error.message);

        var newStock = sr.data.stock === null || sr.data.stock === undefined
          ? null                        // unlimited warehouse stays unlimited
          : Number(sr.data.stock) + qty;
        if (newStock !== null) {
          var u2 = await sb.from('stock_items').update({ stock: newStock }).eq('id', p.source_stock_item_id);
          if (u2.error) {
            return err('ตั้งสต็อกรายการเป็น 0 แล้ว แต่บวกคืนคลังไม่สำเร็จ: ' + u2.error.message + ' — กรุณาปรับคลังเอง (+' + qty + ')');
          }
        }
        return ok({ returned: qty });
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
        id = String(id || '').trim();
        if (!id) return err('กรุณากรอกรหัสสินค้า');
        var pid = (_prodRowMap[sheetId] || {})[rowIndex];
        if (!pid) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var r = await sb.from('products').update({
          code: id,
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

    // Saves many stock values in one round trip (the old sheet code
    // needed one write per cell). changes: [{rowIndex, remaining}]
    adminUpdateStockBulk: async function (sheetId, changes) {
      try {
        requireSb(); await requireAdmin();
        if (!changes || !changes.length) return ok({ saved: 0 });
        var map = _prodRowMap[sheetId] || {};
        var byId = {};
        changes.forEach(function (c) {
          var pid = map[c.rowIndex];
          if (pid) byId[pid] = numOrNull(c.remaining);
        });
        var ids = Object.keys(byId);
        if (!ids.length) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');

        // Confirm the rows still exist so the upsert can never
        // insert ghost products for stale ids.
        var existing = await sb.from('products').select('id').in('id', ids);
        if (existing.error) return err(existing.error.message);
        var payload = (existing.data || []).map(function (row) {
          return { id: row.id, list_id: sheetId, remaining: byId[row.id] };
        });
        if (!payload.length) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');

        var r = await sb.from('products').upsert(payload, { onConflict: 'id' });
        if (r.error) return err(r.error.message);
        return ok({ saved: payload.length });
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
        var target = String(customerName || '').trim();
        var q = sb.from('orders')
          .select('product,qty,total,total_yuan,full_price,total_full,created_at')
          .eq('list_id', sheetId)
          .eq('customer', target);
        if (startDate) {
          q = q.gte('created_at', new Date(startDate + 'T00:00:00').toISOString());
        }
        if (endDate) {
          var exclusiveEnd = new Date(endDate + 'T00:00:00');
          exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
          q = q.lt('created_at', exclusiveEnd.toISOString());
        }
        var qr = await q.order('created_at', { ascending: true });
        if (qr.error) return err(qr.error.message);
        var customerOrders = qr.data || [];

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
        requireSb(); await requireAdmin();
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
      } catch (e) { return e.__json || err(e.message || e); }
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
        var r = await sb.from('stock_items')
          .select('id,seq,parent_id,code,name,image,price,deposit,yuan,stock,status')
          .order('seq', { ascending: true });
        if (r.error) return err(r.error.message);
        var data = r.data || [];

        var linked = await sb.from('products')
          .select('source_stock_item_id,list_id')
          .not('source_stock_item_id', 'is', null);
        if (linked.error) return err(linked.error.message);
        var linkedListsByStock = {};
        (linked.data || []).forEach(function (row) {
          var sourceId = row.source_stock_item_id;
          if (!sourceId) return;
          var lists = linkedListsByStock[sourceId] || (linkedListsByStock[sourceId] = {});
          lists[row.list_id] = true;
        });

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
            linkedListCount: Object.keys(linkedListsByStock[p.id] || {}).length,
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

    // Copies warehouse catalog fields to products that were previously pushed
    // into order lists. The per-list `remaining` value is intentionally not
    // touched because each shop tracks its own sellable quantity.
    adminSyncStockProductToLinked: async function (parentRowIndex) {
      try {
        requireSb(); await requireAdmin();
        var parentId = _stockRowMap[parentRowIndex];
        if (!parentId) return err('ไม่พบสินค้าในคลัง (กรุณารีเฟรช)');

        var parentResult = await sb.from('stock_items')
          .select('id,parent_id,code,name,image,price,deposit,yuan,status')
          .eq('id', parentId)
          .single();
        if (parentResult.error) return err(parentResult.error.message);
        if (parentResult.data.parent_id) return err('กรุณาซิงก์จากสินค้าหลัก');

        var childrenResult = await sb.from('stock_items')
          .select('id,seq,code,name')
          .eq('parent_id', parentId)
          .order('seq', { ascending: true });
        if (childrenResult.error) return err(childrenResult.error.message);

        var parent = parentResult.data;
        var children = childrenResult.data || [];
        var payload = {
          name: String(parent.name || ''),
          image: String(parent.image || ''),
          price: num(parent.price),
          deposit: num(parent.deposit),
          yuan: num(parent.yuan),
          status: parent.status || 'Open',
          options: children.map(function (child) {
            return String(child.name || '') + ':' + String(child.code || '');
          }).join(',')
        };
        // Option products use an independent parent code. For single products,
        // the warehouse barcode remains the product barcode in every shop.
        if (!children.length) payload.code = String(parent.code || '');

        var updated = await sb.from('products')
          .update(payload)
          .eq('source_stock_item_id', parentId)
          .select('id,list_id');
        if (updated.error) return err(updated.error.message);

        var listIds = {};
        (updated.data || []).forEach(function (row) { listIds[row.list_id] = true; });
        return ok({
          updatedProducts: (updated.data || []).length,
          updatedLists: Object.keys(listIds).length
        });
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
        var wantedIds = [];
        items.forEach(function (item) {
          var parentId = _stockRowMap[item.parentRowIndex];
          if (parentId && wantedIds.indexOf(parentId) === -1) wantedIds.push(parentId);
          (item.childRowIndexes || []).forEach(function (ri) {
            var childId = _stockRowMap[ri];
            if (childId && wantedIds.indexOf(childId) === -1) wantedIds.push(childId);
          });
        });
        if (!wantedIds.length) return err('ไม่มีสินค้าที่นำเข้าได้');
        var all = await sb.from('stock_items')
          .select('id,seq,parent_id,code,name,image,price,deposit,yuan,stock,status')
          .in('id', wantedIds);
        if (all.error) return err(all.error.message);
        var byId = {};
        (all.data || []).forEach(function (row) { byId[row.id] = row; });

        // Reserved-inventory model: pushing N units allocates them to the
        // list, so the warehouse loses N. Validate everything up front so
        // a failed push never half-deducts.
        var deductions = []; // {id, stock: newValue}

        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var pid = _stockRowMap[item.parentRowIndex];
          if (!pid) continue;
          var p = byId[pid];
          if (!p || !p.name) continue;

          var kidIds = (item.childRowIndexes || [])
            .map(function (ri) { return _stockRowMap[ri]; })
            .filter(Boolean);
          var kids = [];
          if (kidIds.length) {
            kids = kidIds.map(function (id) { return byId[id]; })
              .filter(function (k) { return k && k.name; })
              .sort(function (a, b) { return Number(a.seq) - Number(b.seq); });
          }

          if (!kids.length) {
            var qty = Number(item.qty) || 1;
            var tracked = p.stock !== null && p.stock !== undefined && p.stock !== '';
            if (tracked && Number(p.stock) < qty) {
              return err('สต็อกในคลังไม่พอสำหรับ "' + p.name + '" (เหลือ ' + Number(p.stock) + ' ชิ้น)');
            }
            if (tracked) deductions.push({ id: p.id, stock: Number(p.stock) - qty });
            rows.push({
              list_id: targetSheetId,
              source_stock_item_id: p.id,
              code: p.code || randomCode(),
              name: p.name, image: p.image || '',
              price: num(p.price), deposit: num(p.deposit),
              remaining: qty,
              status: p.status || 'Open',
              yuan: num(p.yuan),
              options: ''
            });
          } else {
            var optStr = kids.map(function (k) {
              return (k.name || '') + ':' + (k.code || '');
            }).join(',');
            // Option groups allocate ALL tracked option stock to the list
            // (sum of children); untracked children keep the group unlimited.
            var allTracked = kids.every(function (k) {
              return k.stock !== null && k.stock !== undefined && k.stock !== '';
            });
            var sumStock = null;
            if (allTracked) {
              sumStock = kids.reduce(function (s, k) { return s + Number(k.stock); }, 0);
              kids.forEach(function (k) { deductions.push({ id: k.id, stock: 0 }); });
            }
            rows.push({
              list_id: targetSheetId,
              source_stock_item_id: p.id,
              code: randomCode(),
              name: p.name, image: p.image || '',
              price: num(p.price), deposit: num(p.deposit),
              remaining: sumStock,
              status: p.status || 'Open',
              yuan: num(p.yuan),
              options: optStr
            });
          }
        }
        if (!rows.length) return err('ไม่มีสินค้าที่นำเข้าได้');
        var r = await sb.from('products').insert(rows);
        if (r.error) return err(r.error.message);

        // Deduct warehouse stock after the products were created
        if (deductions.length) {
          var d = await sb.from('stock_items').upsert(deductions, { onConflict: 'id' });
          if (d.error) {
            return err('นำสินค้าเข้าแล้ว แต่ตัดสต็อกคลังไม่สำเร็จ: ' + d.error.message + ' — กรุณาปรับสต็อกคลังเอง');
          }
        }
        return ok({ pushed: rows.length, deducted: deductions.length });
      } catch (e) { return e.__json || err(e.message || e); }
    }
  };

  // Checkout ids make order submission retries idempotent
  window.__newCheckoutId = function () {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  window.__api = API;
  window.__sbSignOut = function () {
    _adminVerified = false;
    return sb ? sb.auth.signOut() : Promise.resolve();
  };

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
