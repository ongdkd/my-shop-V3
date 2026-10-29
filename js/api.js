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

  function normalizeBarcode(value) {
    return String(value || '').trim().toLowerCase();
  }

  async function fetchStockBarcodeMatches(barcodes) {
    var wanted = {};
    (barcodes || []).forEach(function (code) {
      var key = normalizeBarcode(code);
      if (key) wanted[key] = true;
    });
    if (!Object.keys(wanted).length) return [];

    // Fetching the compact warehouse barcode index avoids wildcard escaping
    // problems and makes matching consistently trim/case-insensitive.
    var r = await sb.from('stock_items')
      .select('id,parent_id,code,name,image,stock')
      .neq('code', '');
    if (r.error) throw r.error;
    return (r.data || []).filter(function (row) {
      return !!wanted[normalizeBarcode(row.code)];
    });
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
        message = 'Google Sheets API ปฏิเสธคำขอ — ตรวจสอบว่าเปิด API, จำกัด key ให้ตรงโดเมน และแชร์ชีตเป็น “ทุกคนที่มีลิงก์ดูได้”' +
          (message ? ' (' + message + ')' : '');
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

  // ── Old status sheet (one tab per quarter, kept by hand) ──
  // Imported into legacy_orders from admin. Columns move between tabs, so
  // they are found by header text; the tracking number is whatever cell
  // looks like one (some tabs swap the เลขพัสดุ / หมายเหตุ headers).
  var STATUS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1tXcsJ-qNRGLXsPCSu4srsmuibxhYZZTRrALn5BVeIx8/edit';
  var TRACKING_RE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

  function normName(n) { return String(n || '').trim().toLowerCase().replace(/^@+/, ''); }

  async function fetchStatusSheet(spreadsheetId) {
    var id = encodeURIComponent(spreadsheetId);
    var meta = await googleSheetsRequest('spreadsheets/' + id, [['fields', 'sheets.properties.title']]);
    var titles = (meta.sheets || []).map(function (s) { return s.properties.title; });
    if (!titles.length) return [];
    var vals = await googleSheetsRequest('spreadsheets/' + id + '/values:batchGet',
      titles.map(function (t) { return ['ranges', "'" + t.replace(/'/g, "''") + "'"]; })
        .concat([['valueRenderOption', 'FORMATTED_VALUE']]));
    return (vals.valueRanges || []).map(function (vr, i) { return { title: titles[i].trim(), rows: vr.values || [] }; });
  }

  function parseStatusTab(tab) {
    var head = (tab.rows[0] || []).map(function (h) { return String(h || ''); });
    function col(word) { for (var i = 0; i < head.length; i++) if (head[i].indexOf(word) !== -1) return i; return -1; }
    var c = { name: col('ชื่อแอค'), product: col('ชื่อสินค้า'), qty: col('จำนวน'), pay: col('สถานะชำระ'), status: col('สถานะของ'), note: col('หมายเหตุ'), channel: col('ช่องทาง') };
    if (c.name < 0) return [];
    function at(row, i) { return i >= 0 ? String(row[i] || '').trim() : ''; }
    var out = [], last = '';
    for (var r = 1; r < tab.rows.length; r++) {
      var row = tab.rows[r], customer = at(row, c.name), product = at(row, c.product);
      // Merged name cells only fill their first row: a row with no name and
      // no channel continues the order above. A new order without a name is skipped.
      if (!customer && product && c.channel >= 0 && !at(row, c.channel)) customer = last;
      if (customer) last = customer;
      if (!customer || !product) continue;
      var tracking = '';
      for (var k = 0; k < row.length && !tracking; k++) {
        var v = String(row[k] || '').trim();
        if (TRACKING_RE.test(v)) tracking = v;
      }
      var status = at(row, c.status);
      if (/^(cancle|cancel|ยกเลิก)/i.test(status)) status = 'ยกเลิก';
      var note = at(row, c.note);
      out.push({ round: tab.title, customer: customer, product: product, qty: at(row, c.qty),
        pay: at(row, c.pay), status: status, tracking: tracking, note: TRACKING_RE.test(note) ? '' : note });
    }
    return out;
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
  var _orderRowMap = {};             // listId -> { rowIndex(seq) -> orders.id }
  var _stockRowMap = {};             // rowIndex -> stock_items.id

  function listIdFromRow(rowIndex) { return _listRowMap[rowIndex] || null; }

  // Free-gift rules of a list, cleaned for the UI (submit_order re-checks them)
  function giftRulesOf(row) {
    return (Array.isArray(row && row.gift_rules) ? row.gift_rules : []).filter(function (g) {
      return g && String(g.name || '').trim() && isFinite(Number(g.min));
    }).map(function (g) {
      return {
        id: String(g.id || ''), name: String(g.name).trim(), min: Number(g.min),
        currency: g.currency === 'CNY' ? 'CNY' : 'THB',
        stock: g.stock === null || g.stock === undefined || g.stock === '' ? null : Math.max(0, Math.floor(Number(g.stock)) || 0)
      };
    });
  }

  async function fetchLists() {
    // '*' (not a column list) so the optional gift_rules / gift_mode columns are
    // picked up once schema.sql has been run, and nothing breaks before that
    var r = await sb.from('order_lists')
      .select('*')
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchProducts(listId) {
    var r = await sb.from('products')
      // `*` keeps this client compatible while the optional option_details
      // migration is being rolled out. Older databases simply omit it.
      .select('*')
      .eq('list_id', listId)
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  async function fetchOrders(listId) {
    var r = await sb.from('orders')
      // `*` keeps this working before the shipped_at/tracking migration runs
      .select('*')
      .eq('list_id', listId)
      .order('seq', { ascending: true });
    if (r.error) throw r.error;
    return r.data || [];
  }

  // Customer slips without the photo. Empty before the payments migration.
  async function fetchPayments(listId) {
    var q = sb.from('payments').select('id,list_id,customer,amount,paid_at,bank_ref,address,created_at,has_slip')
      .order('created_at', { ascending: false });
    if (listId) q = q.eq('list_id', listId);
    var r = await q;
    if (r.error) { console.warn('[api] payments:', r.error.message); return []; }
    return (r.data || []).map(function (p) {
      return { id: p.id, listId: p.list_id, customer: p.customer, amount: num(p.amount), paidAt: p.paid_at || '',
        bankRef: p.bank_ref || '', address: p.address || '', createdAt: p.created_at, hasSlip: !!p.has_slip };
    });
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
      remark: r.remark || '',
      checkoutId: r.checkout_id || '',  // groups the items of one checkout
      id: r.id,
      listId: r.list_id || '',
      status: r.status || '',           // '' waiting · 'ยกเลิก' · custom label
      shippedAt: r.shipped_at || '',
      tracking: r.tracking || ''
    };
  }

  // ── Option-aware stock return, shared by the single / bulk / clear-list
  // paths. Single products credit their linked warehouse row; option
  // products give each option's unsold units back to the matching
  // warehouse CHILD row (matched by barcode, then name). Options with no
  // matching child are left untouched so their counts are never lost.
  async function performStockReturn(prods) {
    var singles = [], optionProds = [];
    (prods || []).forEach(function (p) {
      if (!p.source_stock_item_id) return;
      var det = Array.isArray(p.option_details) ? p.option_details : [];
      if (det.length) {
        if (det.some(function (o) { return Number(o.remaining) > 0; })) optionProds.push(p);
      } else if (p.remaining !== null && p.remaining !== undefined && Number(p.remaining) > 0) {
        singles.push(p);
      }
    });
    if (!singles.length && !optionProds.length) return { returned: 0, count: 0 };

    // Load the warehouse rows involved: parents for singles, children for options
    var stockById = {}, kidsByParent = {};
    var parentIds = singles.map(function (p) { return p.source_stock_item_id; });
    if (parentIds.length) {
      var sr = await sb.from('stock_items').select('id,stock').in('id', parentIds);
      if (sr.error) throw { __json: err(sr.error.message) };
      (sr.data || []).forEach(function (s) { stockById[s.id] = s; });
    }
    var srcIds = optionProds.map(function (p) { return p.source_stock_item_id; });
    if (srcIds.length) {
      var kr = await sb.from('stock_items').select('id,parent_id,code,name,stock').in('parent_id', srcIds);
      if (kr.error) throw { __json: err(kr.error.message) };
      (kr.data || []).forEach(function (k) {
        stockById[k.id] = k;
        (kidsByParent[k.parent_id] = kidsByParent[k.parent_id] || []).push(k);
      });
    }
    function matchChild(kids, opt) {
      var code = String(opt.code || '').trim().toLowerCase();
      var name = String(opt.name || '').trim().toLowerCase();
      var hit = null;
      if (code) hit = kids.find(function (k) { return String(k.code || '').trim().toLowerCase() === code; });
      if (!hit && name) hit = kids.find(function (k) { return String(k.name || '').trim().toLowerCase() === name; });
      return hit || null;
    }

    // Work out every credit BEFORE touching the list, so an option that
    // cannot be matched keeps its count instead of being zeroed into thin air
    var addById = {}, total = 0, count = 0;
    var singleIds = [], optionPatches = []; // {id, remaining, option_details}
    singles.forEach(function (p) {
      var q = Number(p.remaining);
      addById[p.source_stock_item_id] = (addById[p.source_stock_item_id] || 0) + q;
      total += q; count++;
      singleIds.push(p.id);
    });
    optionProds.forEach(function (p) {
      var kids = kidsByParent[p.source_stock_item_id] || [];
      var matchedAny = false, hasUnlimited = false, leftover = 0;
      var newDet = p.option_details.map(function (o) {
        var c = {};
        Object.keys(o).forEach(function (k2) { c[k2] = o[k2]; });
        var q = Number(o.remaining);
        if (o.remaining === null || o.remaining === undefined) { hasUnlimited = true; return c; }
        if (q > 0) {
          var child = matchChild(kids, o);
          if (child) {
            addById[child.id] = (addById[child.id] || 0) + q;
            total += q; matchedAny = true;
            c.remaining = 0;
            return c;
          }
          leftover += q; // unmatched — keep its count in the list
        }
        return c;
      });
      if (matchedAny) {
        count++;
        optionPatches.push({ id: p.id, remaining: hasUnlimited ? null : leftover, option_details: newDet });
      }
    });
    if (!count) return { returned: 0, count: 0 };

    // Zero the list stock first so a mid-way failure can only
    // under-count the warehouse, never double-count sellable stock
    if (singleIds.length) {
      var z = await sb.from('products').update({ remaining: 0 }).in('id', singleIds);
      if (z.error) throw { __json: err(z.error.message) };
    }
    for (var i = 0; i < optionPatches.length; i++) {
      var op = optionPatches[i];
      var zo = await sb.from('products')
        .update({ remaining: op.remaining, option_details: op.option_details })
        .eq('id', op.id);
      if (zo.error) throw { __json: err(zo.error.message) };
    }

    var ups = [];
    Object.keys(addById).forEach(function (sid2) {
      var s = stockById[sid2];
      // Unlimited warehouse rows stay unlimited — no number to add to
      if (s && s.stock !== null && s.stock !== undefined) {
        ups.push({ id: sid2, stock: Number(s.stock) + addById[sid2] });
      }
    });
    if (ups.length) {
      var u = await sb.from('stock_items').upsert(ups, { onConflict: 'id' });
      if (u.error) throw { __json: err('ตั้งสต็อกรายการเป็น 0 แล้ว แต่บวกคืนคลังไม่ครบ: ' + u.error.message + ' — กรุณาตรวจคลังเอง') };
    }
    return { returned: total, count: count };
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

    // ── Customer status page (public, by @name) ─────────────
    // Web orders, slips already sent, and imported old-sheet rows.
    customerLookup: async function (name) {
      try {
        requireSb();
        name = String(name || '').trim();
        if (normName(name).length < 2) return err('กรุณากรอกชื่อ @ ของคุณ');
        var r = await sb.rpc('customer_orders', { p_name: name });
        if (r.error) {
          if (r.error.code === 'PGRST202') return err('ระบบเช็คสถานะยังไม่พร้อม กรุณาติดต่อร้าน');
          return err(r.error.message);
        }
        var d = r.data || {};
        return ok({ orders: d.orders || [], payments: d.payments || [], legacy: d.legacy || [] });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    customerSubmitPayment: async function (name, listId, amount, paidAt, bankRef, address, slip) {
      try {
        requireSb();
        var r = await sb.rpc('customer_submit_payment', {
          p_name: String(name || '').trim(), p_list_id: listId, p_amount: Number(amount),
          p_paid_at: paidAt || null, p_bank_ref: bankRef || '', p_address: address || '', p_slip: slip
        });
        if (r.error) {
          // Duplicate bank ref racing past the check hits the unique index
          if (r.error.code === '23505') return err('สลิปนี้ถูกส่งมาแล้ว');
          return err(r.error.message);
        }
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
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
          sheetId: row.id,
          giftRules: giftRulesOf(row),
          giftMode: row.gift_mode === 'best' ? 'best' : 'all'
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
            yuan: num(r.yuan), // for the cart's free-gift progress (¥ thresholds)
            remaining: r.remaining === null || r.remaining === undefined ? null : Number(r.remaining),
            status: r.status || 'Open',
            options: r.options
              ? String(r.options).split(',').map(function (o) { return o.trim(); }).filter(Boolean)
              : [],
            optionDetails: Array.isArray(r.option_details) ? r.option_details : []
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
            display: String(row.display || '').trim(),
            giftRules: giftRulesOf(row),
            giftMode: row.gift_mode === 'best' ? 'best' : 'all',
            giftsReady: Object.prototype.hasOwnProperty.call(row, 'gift_rules') // schema.sql has been run
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

    adminUpdateOrderListRow: async function (rowIndex, desc, image, name) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var changes = { description: String(desc || ''), image: String(image || '') };
        // Only web-created lists can be renamed here. Imported list names stay
        // tied to their source spreadsheet title.
        if (name !== null && name !== undefined) {
          var nextName = String(name || '').trim();
          if (!nextName) return err('กรุณากรอกชื่อรายการ');
          var current = await sb.from('order_lists')
            .select('source_spreadsheet_id')
            .eq('id', id)
            .single();
          if (current.error) return err(current.error.message);
          if (String(current.data.source_spreadsheet_id || '').trim()) {
            return err('รายการนี้เชื่อมกับ Google Sheet จึงเปลี่ยนชื่อจากหน้านี้ไม่ได้');
          }
          changes.name = nextName;
        }
        var r = await sb.from('order_lists')
          .update(changes)
          .eq('id', id);
        if (r.error) return err(r.error.message);
        return ok({});
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Save a list's free-gift rules: rules = [{id,name,min,currency,stock}], mode = 'all' | 'best'
    adminSaveListGifts: async function (rowIndex, rules, mode) {
      try {
        requireSb(); await requireAdmin();
        var id = listIdFromRow(rowIndex);
        if (!id) return err('ไม่พบรายการ');
        var clean = [];
        for (var i = 0; i < (rules || []).length; i++) {
          var g = rules[i] || {};
          var name = String(g.name || '').trim();
          var min = Number(g.min);
          if (!name) return err('ของแถมข้อ ' + (i + 1) + ': กรุณาใส่ชื่อของแถม');
          if (!(min > 0)) return err('ของแถมข้อ ' + (i + 1) + ': ยอดขั้นต่ำต้องมากกว่า 0');
          var stock = g.stock === null || g.stock === undefined || g.stock === '' ? null : Math.floor(Number(g.stock));
          if (stock !== null && !(stock >= 0)) return err('ของแถมข้อ ' + (i + 1) + ': จำนวนต้องเป็น 0 ขึ้นไป');
          clean.push({ id: String(g.id || randomCode()), name: name, min: min, currency: g.currency === 'CNY' ? 'CNY' : 'THB', stock: stock });
        }
        var r = await sb.from('order_lists')
          .update({ gift_rules: clean, gift_mode: mode === 'best' ? 'best' : 'all' })
          .eq('id', id);
        if (r.error) {
          if (/gift_(rules|mode)/.test(String(r.error.message || ''))) return err('กรุณาอัปเดตฐานข้อมูลด้วยไฟล์ supabase/schema.sql ก่อนใช้ของแถม');
          return err(r.error.message);
        }
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
        var both = await Promise.all([fetchOrders(sheetId), fetchPayments(sheetId)]);
        var data = both[0];
        var omap = {};
        data.forEach(function (r) { omap[r.seq] = r.id; });
        _orderRowMap[sheetId] = omap;
        var orders = data.map(mapOrder);
        return ok({ orders: orders, payments: both[1] });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Deletes selected order rows (test/mistake cleanup). Stock that the
    // orders deducted is NOT restored automatically — adjust it in the
    // products panel if needed.
    adminDeleteOrders: async function (sheetId, rowIndexes) {
      try {
        requireSb(); await requireAdmin();
        var omap = _orderRowMap[sheetId] || {};
        var ids = (rowIndexes || []).map(function (ri) { return omap[ri]; }).filter(Boolean);
        if (!ids.length) return err('ไม่พบคำสั่งซื้อ (กรุณารีเฟรชหน้า)');
        var r = await sb.from('orders').delete().in('id', ids).select('id');
        if (r.error) return err(r.error.message);
        return ok({ deleted: (r.data || []).length });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Sets the status of order rows (by id). 'shipped' stamps shipped_at
    // with an optional tracking number; any other value ('' = waiting,
    // 'ยกเลิก', or a custom label) clears shipping.
    adminSetOrderStatus: async function (orderIds, status, tracking) {
      try {
        requireSb(); await requireAdmin();
        if (!orderIds || !orderIds.length) return err('ไม่พบคำสั่งซื้อ');
        var patch = status === 'shipped'
          ? { shipped_at: new Date().toISOString(), tracking: String(tracking || '').trim(), status: '' }
          : { shipped_at: null, tracking: '', status: String(status || '').trim().slice(0, 40) };
        var r = await sb.from('orders').update(patch).in('id', orderIds).select('id');
        if (r.error) {
          if (/shipped_at|tracking|status/.test(String(r.error.message || ''))) {
            return err('Supabase ยังไม่มีคอลัมน์สถานะ — รันไฟล์ supabase/migrations/2026-10-29-order-status-payments.sql ใน SQL Editor แล้วลองใหม่');
          }
          return err(r.error.message);
        }
        return ok({ updated: (r.data || []).length, shippedAt: patch.shipped_at, tracking: patch.tracking, orderStatus: patch.status });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Re-imports the old status sheet: every tab, replacing what was
    // imported before (status changes made in admin are overwritten).
    adminImportStatusSheet: async function (sheetUrl) {
      try {
        requireSb(); await requireAdmin();
        var id = spreadsheetIdFromUrl(sheetUrl || STATUS_SHEET_URL);
        if (!id) return err('URL Google Spreadsheet ไม่ถูกต้อง');
        var tabs = await fetchStatusSheet(id);
        var rows = [], perTab = [];
        tabs.forEach(function (t) { var r = parseStatusTab(t); perTab.push({ title: t.title, rows: r.length }); rows = rows.concat(r); });
        if (!rows.length) return err('ไม่พบข้อมูลในชีต (ต้องมีหัวคอลัมน์ "ชื่อแอคลูกค้า" และ "ชื่อสินค้า")');
        var r = await sb.rpc('admin_import_legacy', { p_rows: rows });
        if (r.error) {
          if (r.error.code === 'PGRST202') return err('Supabase ยังไม่มีฟังก์ชันนำเข้า — รันไฟล์ supabase/migrations/2026-10-29b-legacy-status.sql ก่อน');
          return err(r.error.message);
        }
        return ok({ imported: r.data, tabs: perTab });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminGetLegacy: async function () {
      try {
        requireSb(); await requireAdmin();
        var data = [], from = 0, pageSize = 1000;
        while (true) {
          var r = await sb.from('legacy_orders').select('id,sort,round,customer,product,qty,pay,status,tracking,note')
            .order('sort', { ascending: true }).range(from, from + pageSize - 1);
          if (r.error) {
            if (/legacy_orders/.test(r.error.message || '')) return ok({ rows: [], missing: true });
            return err(r.error.message);
          }
          data = data.concat(r.data || []);
          if (!r.data || r.data.length < pageSize) break;
          from += pageSize;
        }
        return ok({ rows: data });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Same contract as adminSetOrderStatus. Old rows have no shipped date,
    // so "shipped" is stored as the label จัดส่งแล้ว.
    adminSetLegacyStatus: async function (ids, status, tracking) {
      try {
        requireSb(); await requireAdmin();
        if (!ids || !ids.length) return err('ไม่พบรายการ');
        var patch = status === 'shipped'
          ? { status: 'จัดส่งแล้ว', tracking: String(tracking || '').trim() }
          : { status: String(status || '').trim().slice(0, 40), tracking: '' };
        var r = await sb.from('legacy_orders').update(patch).in('id', ids).select('id');
        if (r.error) return err(r.error.message);
        return ok({ updated: (r.data || []).length, shippedAt: null, tracking: patch.tracking, orderStatus: patch.status });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Every slip sent, newest first (no photos)
    adminGetPayments: async function () {
      try {
        requireSb(); await requireAdmin();
        return ok({ payments: await fetchPayments(null) });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Full slip photo for one payment (the list call leaves it out)
    adminGetPaymentSlip: async function (paymentId) {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('payments').select('slip_image').eq('id', paymentId).single();
        if (r.error) return err(r.error.message);
        return ok({ slip: r.data.slip_image || '' });
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

    // POS-only sales history for one order list. Order rows are grouped by
    // checkout_id so a basket with several products appears as one sale.
    adminGetPosHistory: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var rows = [], from = 0, pageSize = 1000, truncated = false;
        while (true) {
          var r = await sb.from('orders')
            .select('id,checkout_id,product,qty,total,created_at')
            .eq('list_id', sheetId)
            .eq('remark', 'POS')
            .order('created_at', { ascending: false })
            .range(from, from + pageSize - 1);
          if (r.error) return err(r.error.message);
          rows = rows.concat(r.data || []);
          if (!r.data || r.data.length < pageSize) break;
          from += pageSize;
          if (from >= 100000) { truncated = true; break; }
        }

        var sales = [], byCheckout = {};
        var totalSales = 0, totalItems = 0, todaySales = 0;
        var today = new Date();
        var todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        var tomorrowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();

        rows.forEach(function (row) {
          var createdAt = row.created_at || '';
          // now() is stable within one PostgreSQL transaction, so legacy POS
          // rows without checkout_id can still be grouped by exact timestamp.
          var key = row.checkout_id || ('legacy:' + createdAt);
          var sale = byCheckout[key];
          if (!sale) {
            sale = byCheckout[key] = {
              id: key,
              checkoutId: row.checkout_id || '',
              createdAt: createdAt,
              total: 0,
              quantity: 0,
              items: []
            };
            sales.push(sale);
          }
          var lineTotal = num(row.total);
          var qty = num(row.qty);
          sale.total += lineTotal;
          sale.quantity += qty;
          sale.items.push({ product: row.product || '', qty: qty, total: lineTotal });
          totalSales += lineTotal;
          totalItems += qty;
          var stamp = new Date(createdAt).getTime();
          if (stamp >= todayStart && stamp < tomorrowStart) todaySales += lineTotal;
        });

        return ok({
          sales: sales.slice(0, 100),
          totalSales: totalSales,
          todaySales: todaySales,
          transactionCount: sales.length,
          totalItems: totalItems,
          historyLimited: sales.length > 100,
          truncated: truncated
        });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Full data export for backups — the Supabase free tier has no
    // point-in-time recovery, so this download is the shop's safety net.
    // Snapshots kept inside Supabase (public.backups, filled nightly by pg_cron)
    adminListBackups: async function () {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('backups').select('id, created_at, summary').order('id', { ascending: false });
        if (r.error) return err(/backups/.test(r.error.message)
          ? 'ยังไม่ได้เปิดระบบสำรองอัตโนมัติ — รัน supabase/migrations/2026-10-28-auto-backup.sql ใน SQL Editor ก่อนค่ะ'
          : r.error.message);
        return ok({ backups: r.data || [] });
      } catch (e) { return e.__json || err(e.message || e); }
    },
    adminTakeBackup: async function () {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.rpc('take_backup');
        if (r.error) return err(r.error.message);
        return ok({ id: r.data });
      } catch (e) { return e.__json || err(e.message || e); }
    },
    adminGetBackup: async function (id) {
      try {
        requireSb(); await requireAdmin();
        var r = await sb.from('backups').select('created_at, data').eq('id', id).single();
        if (r.error) return err(r.error.message);
        return ok({ exportedAt: r.data.created_at, data: r.data.data });
      } catch (e) { return e.__json || err(e.message || e); }
    },

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
            .select('*,order_lists(name)')
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
        return ok({ orders: orders, payments: await fetchPayments(null), truncated: truncated });
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
            optionDetails: Array.isArray(r.option_details) ? r.option_details.map(function (opt) {
              return {
                name: String(opt.name || ''),
                code: String(opt.code || opt.barcode || ''),
                image: String(opt.image || ''),
                remaining: opt.remaining === null || opt.remaining === undefined || opt.remaining === ''
                  ? null : Number(opt.remaining)
              };
            }) : [],
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
          .select('id,name,remaining,option_details,source_stock_item_id')
          .eq('id', pid).single();
        if (pr.error) return err(pr.error.message);
        var p = pr.data;
        if (!p.source_stock_item_id) return err('สินค้านี้ไม่ได้ลิงก์กับคลัง จึงคืนสต็อกไม่ได้');
        var det = Array.isArray(p.option_details) ? p.option_details : [];
        if (!det.length) {
          if (p.remaining === null || p.remaining === undefined) return err('สินค้านี้ไม่จำกัดจำนวน ไม่มีสต็อกให้คืน');
          if (!(Number(p.remaining) > 0)) return err('ไม่มีสต็อกเหลือให้คืนค่ะ');
        }

        var res = await performStockReturn([p]);
        if (!res.count) {
          return err(det.length
            ? 'ไม่มีสต็อกตัวเลือกที่คืนได้ (ตัวเลือกอาจไม่ตรงกับคลัง)'
            : 'ไม่มีสต็อกเหลือให้คืนค่ะ');
        }
        return ok({ returned: res.returned });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Bulk version of the return above: zero the selected linked
    // products' remaining and add the units back to their warehouse rows.
    adminReturnProductsBulk: async function (sheetId, rowIndexes) {
      try {
        requireSb(); await requireAdmin();
        var map = _prodRowMap[sheetId] || {};
        var ids = (rowIndexes || []).map(function (ri) { return map[ri]; }).filter(Boolean);
        if (!ids.length) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');

        var pr = await sb.from('products')
          .select('id,name,remaining,option_details,source_stock_item_id')
          .in('id', ids);
        if (pr.error) return err(pr.error.message);

        var res = await performStockReturn(pr.data || []);
        if (!res.count) return err('ในรายการที่เลือก ไม่มีสินค้าที่คืนได้ (ต้องลิงก์คลังและมีสต็อกเหลือ)');
        return ok({ returned: res.returned, count: res.count });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminDeleteProductsBulk: async function (sheetId, rowIndexes) {
      try {
        requireSb(); await requireAdmin();
        var map = _prodRowMap[sheetId] || {};
        var ids = (rowIndexes || []).map(function (ri) { return map[ri]; }).filter(Boolean);
        if (!ids.length) return err('ไม่พบสินค้า (กรุณารีเฟรชหน้า)');
        var r = await sb.from('products').delete().in('id', ids).select('id');
        if (r.error) return err(r.error.message);
        return ok({ deleted: (r.data || []).length });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // "Clear list": return every linked product's unsold units to the
    // warehouse, then delete ALL products in the list.
    adminClearListProducts: async function (sheetId) {
      try {
        requireSb(); await requireAdmin();
        var pr = await sb.from('products')
          .select('id,name,remaining,option_details,source_stock_item_id')
          .eq('list_id', sheetId);
        if (pr.error) return err(pr.error.message);
        var all = pr.data || [];
        if (!all.length) return err('รายการนี้ไม่มีสินค้าอยู่แล้วค่ะ');

        var res = await performStockReturn(all);

        var d = await sb.from('products').delete().eq('list_id', sheetId).select('id');
        if (d.error) return err('คืนสต็อกแล้ว แต่ลบสินค้าไม่สำเร็จ: ' + d.error.message);
        return ok({ returned: res.returned, deleted: (d.data || []).length });
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

    // AI product lookup — Supabase Edge Function "identify-product" (holds
    // the Google keys server-side). Returns { name, imageUrl, pageUrl }.
    // opts.variant + opts.product: name one variant of that product instead
    adminIdentifyProduct: async function (image, opts) {
      try {
        requireSb(); await requireAdmin();
        opts = opts || {};
        var r = await sb.functions.invoke('identify-product', {
          body: { image: image, variant: !!opts.variant, product: String(opts.product || '') }
        });
        if (r.error) {
          var st = r.error.context && r.error.context.status;
          if (st === 404) return err('AI ใช้งานไม่ได้ — ยังไม่ได้ deploy ฟังก์ชัน identify-product');
          // 504 / 546 = Supabase stopped a request that ran too long
          return err('AI ไม่ตอบ' + (st ? ' (' + st + ')' : '') + ' — อาจใช้เวลานานเกินไปหรือเน็ตหลุด ลองใหม่อีกครั้ง');
        }
        var d = r.data || {};
        if (d.error) return err(d.error);
        return ok({ name: String(d.name || ''), imageUrl: String(d.imageUrl || ''), imageData: String(d.imageData || ''), pageUrl: String(d.pageUrl || '') });
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
              stockItemId: c.id,
              parentStockItemId: p.id,
              rowIndex: cRow,
              id: c.code || '',
              name: c.name || '',
              image: c.image || '',
              stock: c.stock === null || c.stock === undefined ? null : Number(c.stock)
            };
          });
          return {
            stockItemId: p.id,
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
            linkedListIds: Object.keys(linkedListsByStock[p.id] || {}),
            children: kids
          };
        });
        return ok({ products: products });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminFindStockByBarcode: async function (barcode) {
      try {
        requireSb(); await requireAdmin();
        var code = String(barcode || '').trim();
        if (!code) return err('กรุณากรอกบาร์โค้ด');
        var matches = await fetchStockBarcodeMatches([code]);
        if (!matches.length) return ok({ found: false, barcode: code });

        var match = matches[0];
        var parent = null;
        if (match.parent_id) {
          var pr = await sb.from('stock_items')
            .select('id,code,name,image,stock')
            .eq('id', match.parent_id)
            .single();
          if (pr.error) return err(pr.error.message);
          parent = pr.data;
        }
        return ok({
          found: true,
          barcode: code,
          item: {
            id: match.id,
            code: match.code || '',
            name: match.name || '',
            image: match.image || '',
            stock: match.stock === null || match.stock === undefined ? null : Number(match.stock),
            isOption: !!match.parent_id,
            parentId: match.parent_id || '',
            parentName: parent ? String(parent.name || '') : ''
          }
        });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    adminCreateStockProduct: async function (product, opts) {
      try {
        requireSb(); await requireAdmin();
        var pr = num(product.price), dep = num(product.deposit), yu = num(product.yuan);
        var st = product.status || 'Open';

        var requestedCodes = (!opts || !opts.length)
          ? [String(product.id || '').trim()]
          : opts.map(function (o) { return String(o.id || '').trim(); });
        var seenCodes = {};
        for (var ci = 0; ci < requestedCodes.length; ci++) {
          var codeKey = normalizeBarcode(requestedCodes[ci]);
          if (!codeKey) return err('กรุณากรอกบาร์โค้ดสินค้าให้ครบ');
          if (seenCodes[codeKey]) return err('บาร์โค้ดซ้ำในแบบฟอร์ม: ' + requestedCodes[ci]);
          seenCodes[codeKey] = true;
        }
        var existingCodes = await fetchStockBarcodeMatches(requestedCodes);
        if (existingCodes.length) {
          return err('บาร์โค้ด ' + existingCodes[0].code + ' มีอยู่ในคลังแล้ว (' + existingCodes[0].name + ')');
        }

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

    // Delete many warehouse products at once (children cascade; linked
    // listings in order lists stay, just unlinked via ON DELETE SET NULL).
    adminDeleteStockProductsBulk: async function (parentRowIndexes) {
      try {
        requireSb(); await requireAdmin();
        var ids = (parentRowIndexes || []).map(function (ri) { return _stockRowMap[ri]; }).filter(Boolean);
        if (!ids.length) return err('ไม่พบสินค้าในคลัง (กรุณารีเฟรช)');
        var deleted = 0;
        // Chunked so a huge warehouse doesn't overflow the request URL
        for (var i = 0; i < ids.length; i += 100) {
          var r = await sb.from('stock_items').delete().in('id', ids.slice(i, i + 100)).select('id');
          if (r.error) return err(r.error.message + (deleted ? ' (ลบไปแล้ว ' + deleted + ' รายการ)' : ''));
          deleted += (r.data || []).length;
        }
        return ok({ deleted: deleted });
      } catch (e) { return e.__json || err(e.message || e); }
    },

    // Import warehouse stock into an order list.
    // items: [{ parentRowIndex, qty, childQty: { childRowIndex: qty } }]
    //   • single product      → moves `qty` (unlimited stays unlimited)
    //   • product w/ variants → moves only the chosen per-variant amounts;
    //                           an unlimited variant is included as unlimited
    // Anything already in the target list is ADDED to that listing (stock is
    // summed, new variants appended) instead of failing or making a copy.
    adminPushStockToShop: async function (targetSheetId, items) {
      try {
        requireSb(); await requireAdmin();
        items = items || [];
        var wantedIds = [];
        function want(id) { if (id && wantedIds.indexOf(id) === -1) wantedIds.push(id); }
        items.forEach(function (item) {
          want(_stockRowMap[item.parentRowIndex]);
          Object.keys(item.childQty || {}).forEach(function (ri) { want(_stockRowMap[ri]); });
        });
        if (!wantedIds.length) return err('ไม่มีสินค้าที่นำเข้าได้');
        var all = await sb.from('stock_items')
          .select('id,seq,parent_id,code,name,image,price,deposit,yuan,stock,status')
          .in('id', wantedIds);
        if (all.error) return err(all.error.message);
        var byId = {};
        (all.data || []).forEach(function (row) { byId[row.id] = row; });

        // Listings already in the target list: linked by warehouse id, or —
        // for single products imported before linking existed — same barcode
        var parentIds = items.map(function (it) { return _stockRowMap[it.parentRowIndex]; }).filter(Boolean);
        var exBySource = {}, exByCode = {};
        var exr = await sb.from('products')
          .select('id,code,remaining,options,option_details,source_stock_item_id')
          .eq('list_id', targetSheetId).in('source_stock_item_id', parentIds);
        if (exr.error) return err(exr.error.message);
        (exr.data || []).forEach(function (x) { if (!exBySource[x.source_stock_item_id]) exBySource[x.source_stock_item_id] = x; });
        var singleCodes = items.filter(function (it) { return !Object.keys(it.childQty || {}).length; })
          .map(function (it) { var p = byId[_stockRowMap[it.parentRowIndex]]; return p && p.code ? String(p.code) : ''; })
          .filter(Boolean);
        if (singleCodes.length) {
          var exc = await sb.from('products')
            .select('id,code,remaining,options,option_details,source_stock_item_id')
            .eq('list_id', targetSheetId).in('code', singleCodes);
          if (exc.error) return err(exc.error.message);
          (exc.data || []).forEach(function (x) { exByCode[String(x.code)] = x; });
        }

        function isTracked(v) { return v !== null && v !== undefined && v !== ''; }
        function sameKey(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
        // Older listings may only have the "Name:code,…" string — rebuild details from it
        function detailsOf(x) {
          if (Array.isArray(x.option_details) && x.option_details.length) {
            return x.option_details.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { c[k] = o[k]; }); return c; });
          }
          return String(x.options || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
            var i = s.indexOf(':');
            return { name: i === -1 ? s : s.slice(0, i).trim(), code: i === -1 ? '' : s.slice(i + 1).trim(), image: '', remaining: null };
          });
        }
        function totalOf(det) {
          return det.every(function (d) { return isTracked(d.remaining); })
            ? det.reduce(function (s, d) { return s + Number(d.remaining); }, 0) : null;
        }
        function optionsOf(det) { return det.map(function (d) { return d.code ? d.name + ':' + d.code : d.name; }).join(','); }

        // Validate everything and plan every write BEFORE touching the database,
        // so a bad item never leaves a half-done import
        var inserts = [], updates = [], deductions = [];
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var pid = _stockRowMap[item.parentRowIndex];
          var p = pid && byId[pid];
          if (!p || !p.name) continue;
          var childRows = Object.keys(item.childQty || {});

          if (!childRows.length) {
            var qty = Math.floor(Number(item.qty));
            if (!(qty >= 1)) return err('จำนวนต้องมากกว่า 0 ("' + p.name + '")');
            var tracked = isTracked(p.stock);
            if (tracked && Number(p.stock) < qty) {
              return err('สต็อกในคลังไม่พอสำหรับ "' + p.name + '" (เหลือ ' + Number(p.stock) + ' ชิ้น)');
            }
            if (tracked) deductions.push({ id: p.id, stock: Number(p.stock) - qty });
            var ex1 = exBySource[pid] || (p.code ? exByCode[String(p.code)] : null);
            if (ex1) {
              // Add to what is left in the list. Unlimited warehouse stock keeps
              // the listing unlimited; a tracked import onto an unlimited listing
              // makes it exactly `qty` (the units now reserved for it).
              updates.push({ id: ex1.id, patch: {
                remaining: tracked ? (isTracked(ex1.remaining) ? Number(ex1.remaining) : 0) + qty : null,
                source_stock_item_id: p.id
              } });
            } else {
              inserts.push({
                list_id: targetSheetId, source_stock_item_id: p.id,
                code: p.code || randomCode(), name: p.name, image: p.image || '',
                price: num(p.price), deposit: num(p.deposit), remaining: tracked ? qty : null,
                status: p.status || 'Open', yuan: num(p.yuan), options: '',
                // Keep every row of the bulk insert on the same JSON shape
                option_details: []
              });
            }
            continue;
          }

          var chosen = [];
          for (var c = 0; c < childRows.length; c++) {
            var k = byId[_stockRowMap[childRows[c]]];
            if (!k || !k.name || k.parent_id !== p.id) continue;
            var kTracked = isTracked(k.stock);
            var q = Math.floor(Number(item.childQty[childRows[c]]));
            if (kTracked) {
              if (!(q >= 1)) continue;
              if (Number(k.stock) < q) {
                return err('สต็อกในคลังไม่พอสำหรับ "' + p.name + ' — ' + k.name + '" (เหลือ ' + Number(k.stock) + ' ชิ้น)');
              }
              deductions.push({ id: k.id, stock: Number(k.stock) - q });
            }
            chosen.push({ k: k, q: kTracked ? q : null });
          }
          if (!chosen.length) continue;
          chosen.sort(function (a, b) { return Number(a.k.seq) - Number(b.k.seq); });

          var ex2 = exBySource[pid];
          if (ex2) {
            var det = detailsOf(ex2);
            chosen.forEach(function (ch) {
              var hit = null;
              if (ch.k.code) hit = det.find(function (d) { return sameKey(d.code, ch.k.code); });
              if (!hit) hit = det.find(function (d) { return sameKey(d.name, ch.k.name); });
              if (hit) {
                hit.remaining = ch.q === null ? null : (isTracked(hit.remaining) ? Number(hit.remaining) : 0) + ch.q;
                if (!hit.image && ch.k.image) hit.image = ch.k.image;
                if (!hit.code && ch.k.code) hit.code = ch.k.code;
              } else {
                det.push({ name: String(ch.k.name), code: String(ch.k.code || ''), image: String(ch.k.image || ''), remaining: ch.q });
              }
            });
            updates.push({ id: ex2.id, patch: { remaining: totalOf(det), options: optionsOf(det), option_details: det } });
          } else {
            var newDet = chosen.map(function (ch) {
              return { name: String(ch.k.name), code: String(ch.k.code || ''), image: String(ch.k.image || ''), remaining: ch.q };
            });
            inserts.push({
              list_id: targetSheetId, source_stock_item_id: p.id,
              code: randomCode(), name: p.name, image: p.image || '',
              price: num(p.price), deposit: num(p.deposit), remaining: totalOf(newDet),
              status: p.status || 'Open', yuan: num(p.yuan),
              options: optionsOf(newDet), option_details: newDet
            });
          }
        }
        if (!inserts.length && !updates.length) return err('ไม่มีสินค้าที่นำเข้าได้');

        if (inserts.length) {
          var r = await sb.from('products').insert(inserts);
          if (r.error) {
            var insertMessage = String(r.error.message || '');
            var insertDetails = String(r.error.details || '');
            var insertText = (insertMessage + ' ' + insertDetails).toLowerCase();
            if (r.error.code === 'PGRST204' && insertText.indexOf('option_details') !== -1) {
              return err('กรุณาอัปเดตฐานข้อมูลด้วยไฟล์ supabase/schema.sql ก่อนนำเข้าสินค้าที่มีตัวเลือก');
            }
            return err(insertMessage || insertDetails || 'นำสินค้าเข้าไม่สำเร็จ');
          }
        }
        for (var u = 0; u < updates.length; u++) {
          var up = await sb.from('products').update(updates[u].patch).eq('id', updates[u].id);
          if (up.error) return err('เพิ่มสต็อกให้สินค้าที่มีอยู่ไม่สำเร็จ: ' + up.error.message + ' — กรุณาตรวจสต็อกคลังและรายการ');
        }

        // Deduct warehouse stock after the list was updated
        if (deductions.length) {
          var d = await sb.from('stock_items').upsert(deductions, { onConflict: 'id' });
          if (d.error) {
            return err('นำสินค้าเข้าแล้ว แต่ตัดสต็อกคลังไม่สำเร็จ: ' + d.error.message + ' — กรุณาปรับสต็อกคลังเอง');
          }
        }
        return ok({ pushed: inserts.length + updates.length, added: inserts.length, merged: updates.length, deducted: deductions.length });
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
