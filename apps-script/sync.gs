// ═══════════════════════════════════════════════════════════
// Order Hub — Google Sheets ⇄ Supabase sync engine
//
// Runs as a Google Apps Script project under YOUR Google account:
//   * a time-driven trigger syncs every list on a schedule
//   * a web app endpoint lets the admin panel create the
//     spreadsheet for a new order list immediately and run
//     an on-demand "sync now"
//
// Setup: see apps-script/README.md in the repository.
//
// Sync rules (per order list spreadsheet):
//   * Products tab  — TWO-WAY. The sheet wins for cells you edit
//     in the sheet; Supabase wins for everything else (so stock
//     deducted by customer orders is never clobbered by stale
//     sheet values). Change detection uses the hidden _snapshot
//     tab written on every sync.
//   * Orders tab    — EXPORT ONLY (Supabase → sheet backup).
//   * Deletions are never propagated in either direction; delete
//     products in the admin panel.
//   * The very first sync of a spreadsheet only exports Supabase
//     state and writes the snapshot baseline — sheet edits start
//     flowing into Supabase from the second sync onward.
//
// A master "Order Hub Backup" spreadsheet additionally mirrors the
// order_lists table and the stock_items warehouse (export only).
// ═══════════════════════════════════════════════════════════

var SYNC_EVERY_MINUTES = 30;             // 1, 5, 10, 15 or 30
var SPREADSHEET_PREFIX = 'Order Hub — ';
var MASTER_BACKUP_NAME = 'Order Hub Backup';

var PRODUCT_HEADER = ['ID', 'Name', 'Image', 'Price', 'Deposit', 'Remaining', 'Status', 'Yuan', 'Options'];
var ORDER_HEADER = ['Timestamp', 'Customer', 'Product', 'Qty', 'Pay Type', 'Price', 'Total', 'Yuan', 'Total Yuan', 'Full Price', 'Total Full', 'Remark'];
var LIST_HEADER = ['Name', 'Description', 'Image', 'Status', 'Display', 'Spreadsheet URL', 'Created At', 'Supabase ID'];
var STOCK_HEADER = ['Code', 'Name', 'Parent Code', 'Image', 'Price', 'Deposit', 'Yuan', 'Stock', 'Status'];

var PRODUCT_FIELDS = ['name', 'image', 'price', 'deposit', 'remaining', 'status', 'yuan', 'options'];
var SNAPSHOT_SHEET = '_snapshot';

// ── Configuration (Script Properties) ───────────────────────
function getConfig_() {
  var props = PropertiesService.getScriptProperties();
  var url = String(props.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  var key = String(props.getProperty('SUPABASE_SERVICE_KEY') || '').trim();
  if (!url || !key) {
    throw new Error('Script Properties SUPABASE_URL / SUPABASE_SERVICE_KEY are not set. ' +
      'Open Project Settings → Script Properties and add them.');
  }
  return { url: url, key: key, props: props };
}

function requireSecret_(secret) {
  var expected = String(PropertiesService.getScriptProperties().getProperty('SHARED_SECRET') || '').trim();
  if (!expected) throw new Error('Script Property SHARED_SECRET is not set.');
  if (String(secret || '') !== expected) throw new Error('Invalid secret');
}

// ── Supabase REST helpers ────────────────────────────────────
function sbRequest_(method, pathAndQuery, body) {
  var cfg = getConfig_();
  var options = {
    method: method,
    muteHttpExceptions: true,
    contentType: 'application/json',
    headers: {
      apikey: cfg.key,
      Authorization: 'Bearer ' + cfg.key,
      Prefer: method === 'post' ? 'return=representation' : 'return=minimal'
    }
  };
  if (body !== undefined && body !== null) options.payload = JSON.stringify(body);
  var resp = UrlFetchApp.fetch(cfg.url + '/rest/v1/' + pathAndQuery, options);
  var code = resp.getResponseCode();
  var text = resp.getContentText() || '';
  if (code >= 300) {
    var msg = text;
    try { msg = JSON.parse(text).message || text; } catch (e) {}
    throw new Error('Supabase ' + method.toUpperCase() + ' ' + pathAndQuery.split('?')[0] + ' → ' + code + ': ' + msg);
  }
  if (!text) return [];
  try { return JSON.parse(text); } catch (e2) { return []; }
}

function sbGetAll_(table, query) {
  var out = [], offset = 0, page = 1000;
  while (true) {
    var chunk = sbRequest_('get', table + '?' + query + '&limit=' + page + '&offset=' + offset);
    out = out.concat(chunk);
    if (chunk.length < page) break;
    offset += page;
  }
  return out;
}

// ── Value normalisation (must match how the web app reads sheets) ──
function normText_(v) { return String(v === null || v === undefined ? '' : v).trim(); }

function normNum_(v) {
  var n = Number(String(v === null || v === undefined ? '' : v).replace(/[,฿¥\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function normStock_(v) {
  var s = normText_(v);
  if (s === '') return null;                       // blank = unlimited
  return normNum_(s);
}

function normStatus_(v) {
  var s = normText_(v).toLowerCase();
  return (s === 'closed' || s === 'close' || s === 'ปิด') ? 'Closed' : 'Open';
}

function canonicalProduct_(p) {
  return {
    name: normText_(p.name),
    image: normText_(p.image),
    price: normNum_(p.price),
    deposit: normNum_(p.deposit),
    remaining: (p.remaining === null || p.remaining === undefined || p.remaining === '') ? null : normNum_(p.remaining),
    status: normStatus_(p.status),
    yuan: normNum_(p.yuan),
    options: normText_(p.options)
  };
}

function valueEq_(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function randomCode_() {
  var s = '';
  for (var i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
  return s + '00';
}

// ── Sheet helpers ────────────────────────────────────────────
function headerKey_(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/[._\-\/\\]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function columnFinder_(header) {
  var normalized = header.map(headerKey_);
  return function (aliases, fallback) {
    for (var i = 0; i < aliases.length; i++) {
      var idx = normalized.indexOf(headerKey_(aliases[i]));
      if (idx !== -1) return idx;
    }
    return fallback;
  };
}

function cell_(row, idx) {
  return idx >= 0 && idx < row.length ? row[idx] : '';
}

function writeTable_(ss, title, header, rows) {
  var sh = ss.getSheetByName(title) || ss.insertSheet(title);
  sh.clearContents();
  var data = [header].concat(rows.map(function (r) {
    r = r.slice(0, header.length);
    while (r.length < header.length) r.push('');
    return r;
  }));
  sh.getRange(1, 1, data.length, header.length).setValues(data);
  sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
  return sh;
}

// Snapshot: what this script last wrote to the Products tab.
// A cell that differs from the snapshot was edited in the sheet.
function readSnapshot_(ss) {
  var sh = ss.getSheetByName(SNAPSHOT_SHEET);
  if (!sh) return null;                            // never synced before
  var values = sh.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < values.length; i++) {
    var code = normText_(values[i][0]);
    if (!code) continue;
    try { map[code] = JSON.parse(String(values[i][1] || '{}')); } catch (e) {}
  }
  return map;
}

function writeSnapshot_(ss, products) {
  var rows = products.map(function (p) {
    return [normText_(p.code), JSON.stringify(canonicalProduct_(p))];
  });
  var sh = writeTable_(ss, SNAPSHOT_SHEET, ['code', 'data'], rows);
  sh.hideSheet();
}

function readSheetProducts_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var find = columnFinder_(values[0].map(String));
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
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var name = normText_(cell_(row, c.name));
    if (!name) continue;
    var code = normText_(cell_(row, c.code)) || randomCode_();
    if (seen[code]) continue;                      // first row wins on duplicate codes
    seen[code] = true;
    var obj = canonicalProduct_({
      name: name,
      image: cell_(row, c.image),
      price: cell_(row, c.price),
      deposit: cell_(row, c.deposit),
      remaining: normStock_(cell_(row, c.remaining)),
      status: cell_(row, c.status),
      yuan: cell_(row, c.yuan),
      options: cell_(row, c.options)
    });
    obj.code = code;
    out.push(obj);
  }
  return out;
}

function productToRow_(p) {
  var c = canonicalProduct_(p);
  return [normText_(p.code), c.name, c.image, c.price, c.deposit,
          c.remaining === null ? '' : c.remaining, c.status, c.yuan, c.options];
}

// ── Per-list spreadsheet ─────────────────────────────────────
function ensureListSpreadsheet_(list) {
  var id = normText_(list.source_spreadsheet_id);
  if (id) return id;

  var ss = SpreadsheetApp.create(SPREADSHEET_PREFIX + (normText_(list.name) || 'Order List'));
  var products = ss.getSheets()[0];
  products.setName('Products');
  products.getRange(1, 1, 1, PRODUCT_HEADER.length).setValues([PRODUCT_HEADER]).setFontWeight('bold');
  var orders = ss.insertSheet('Orders');
  orders.getRange(1, 1, 1, ORDER_HEADER.length).setValues([ORDER_HEADER]).setFontWeight('bold');

  var folderId = normText_(PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID'));
  if (folderId) {
    try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId)); }
    catch (e) { console.warn('Could not move spreadsheet to folder: ' + e.message); }
  }

  sbRequest_('patch', 'order_lists?id=eq.' + encodeURIComponent(list.id),
    { source_spreadsheet_id: ss.getId() });
  list.source_spreadsheet_id = ss.getId();
  return ss.getId();
}

function syncListProducts_(list, ss) {
  var sheet = ss.getSheetByName('Products');
  if (!sheet) {
    sheet = ss.insertSheet('Products');
    sheet.getRange(1, 1, 1, PRODUCT_HEADER.length).setValues([PRODUCT_HEADER]).setFontWeight('bold');
  }

  var snapshot = readSnapshot_(ss);                // null = first sync (baseline only)
  var sheetProducts = snapshot === null ? [] : readSheetProducts_(sheet);

  var query = 'select=id,code,name,image,price,deposit,remaining,status,yuan,options' +
    '&list_id=eq.' + encodeURIComponent(list.id) + '&order=seq.asc';
  var supa = sbGetAll_('products', query);
  var byCode = {};
  supa.forEach(function (p) { byCode[normText_(p.code)] = p; });

  var inserts = [], patchCount = 0;
  sheetProducts.forEach(function (sp) {
    var cur = byCode[sp.code];
    if (!cur) {
      // New row typed into the sheet → create the product in Supabase.
      inserts.push({
        list_id: list.id, code: sp.code, name: sp.name, image: sp.image,
        price: sp.price, deposit: sp.deposit, remaining: sp.remaining,
        status: sp.status, yuan: sp.yuan, options: sp.options
      });
      return;
    }
    // Existing product: only fields whose sheet value moved away from the
    // snapshot were edited in the sheet — those win over Supabase.
    var base = snapshot[sp.code] || canonicalProduct_(cur);
    var patch = {};
    PRODUCT_FIELDS.forEach(function (f) {
      if (!valueEq_(sp[f], base[f])) patch[f] = sp[f];
    });
    if (Object.keys(patch).length) {
      sbRequest_('patch', 'products?id=eq.' + encodeURIComponent(cur.id), patch);
      patchCount++;
    }
  });
  if (inserts.length) sbRequest_('post', 'products', inserts);

  // Export the merged canonical state back to the sheet + new baseline.
  var fresh = (inserts.length || patchCount) ? sbGetAll_('products', query) : supa;
  writeTable_(ss, 'Products', PRODUCT_HEADER, fresh.map(productToRow_));
  writeSnapshot_(ss, fresh);

  return { products: fresh.length, importedFromSheet: inserts.length, updatedFromSheet: patchCount, baseline: snapshot === null };
}

function exportOrders_(list, ss) {
  var orders = sbGetAll_('orders',
    'select=customer,product,qty,pay_type,price,total,yuan,total_yuan,full_price,total_full,remark,created_at' +
    '&list_id=eq.' + encodeURIComponent(list.id) + '&order=created_at.asc');
  var rows = orders.map(function (o) {
    return [o.created_at ? new Date(o.created_at) : '', normText_(o.customer), normText_(o.product),
            normNum_(o.qty), normText_(o.pay_type), normNum_(o.price), normNum_(o.total),
            normNum_(o.yuan), normNum_(o.total_yuan), normNum_(o.full_price), normNum_(o.total_full),
            normText_(o.remark)];
  });
  writeTable_(ss, 'Orders', ORDER_HEADER, rows);
  return rows.length;
}

function syncList_(list) {
  var result = { list: normText_(list.name), id: list.id };
  var ssId = ensureListSpreadsheet_(list);
  var ss;
  try {
    ss = SpreadsheetApp.openById(ssId);
  } catch (e) {
    result.error = 'Cannot open spreadsheet ' + ssId + ' — share it with this Google account or clear source_spreadsheet_id.';
    return result;
  }
  var productResult = syncListProducts_(list, ss);
  result.products = productResult.products;
  result.importedFromSheet = productResult.importedFromSheet;
  result.updatedFromSheet = productResult.updatedFromSheet;
  result.baseline = productResult.baseline;
  result.orders = exportOrders_(list, ss);
  result.url = 'https://docs.google.com/spreadsheets/d/' + ssId + '/edit';
  return result;
}

// ── Master backup (order_lists + stock, export only) ────────
function exportMasterBackup_(lists) {
  var props = PropertiesService.getScriptProperties();
  var masterId = normText_(props.getProperty('MASTER_SPREADSHEET_ID'));
  var ss = null;
  if (masterId) {
    try { ss = SpreadsheetApp.openById(masterId); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(MASTER_BACKUP_NAME);
    var first = ss.getSheets()[0];
    first.setName('Order_Lists');
    var folderId = normText_(props.getProperty('DRIVE_FOLDER_ID'));
    if (folderId) {
      try { DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(folderId)); } catch (e2) {}
    }
    props.setProperty('MASTER_SPREADSHEET_ID', ss.getId());
  }

  writeTable_(ss, 'Order_Lists', LIST_HEADER, lists.map(function (l) {
    var srcId = normText_(l.source_spreadsheet_id);
    return [normText_(l.name), normText_(l.description), normText_(l.image),
            normText_(l.status), normText_(l.display),
            srcId ? 'https://docs.google.com/spreadsheets/d/' + srcId + '/edit' : '',
            l.created_at ? new Date(l.created_at) : '', l.id];
  }));

  var stock = sbGetAll_('stock_items',
    'select=id,parent_id,code,name,image,price,deposit,yuan,stock,status&order=seq.asc');
  var codeById = {};
  stock.forEach(function (s) { codeById[s.id] = normText_(s.code) || normText_(s.name); });
  writeTable_(ss, 'Stock', STOCK_HEADER, stock.map(function (s) {
    return [normText_(s.code), normText_(s.name), s.parent_id ? (codeById[s.parent_id] || '') : '',
            normText_(s.image), normNum_(s.price), normNum_(s.deposit), normNum_(s.yuan),
            (s.stock === null || s.stock === undefined) ? '' : normNum_(s.stock), normText_(s.status)];
  }));

  return ss.getId();
}

// ── Entry points ─────────────────────────────────────────────
function syncAll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another sync is already running');
  try {
    var lists = sbGetAll_('order_lists',
      'select=id,name,description,image,status,display,source_spreadsheet_id,created_at&order=seq.asc');
    var summary = [];
    lists.forEach(function (list) {
      try { summary.push(syncList_(list)); }
      catch (e) { summary.push({ list: normText_(list.name), id: list.id, error: String(e.message || e) }); }
    });
    exportMasterBackup_(lists);
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    lock.releaseLock();
  }
}

// Run this once by hand to install the time-driven trigger.
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scheduledSync').timeBased().everyMinutes(SYNC_EVERY_MINUTES).create();
  return 'Trigger installed: scheduledSync every ' + SYNC_EVERY_MINUTES + ' minutes';
}

function scheduledSync() {
  try { syncAll(); }
  catch (e) { console.error('scheduledSync failed: ' + (e.message || e)); }
}

// Manual test helper — run from the editor to sync once and inspect logs.
function testSyncOnce() { return syncAll(); }

// ── Web app endpoint (admin panel calls this) ────────────────
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return handleRequest_(body);
}

function doGet(e) {
  return handleRequest_((e && e.parameter) || {});
}

function handleRequest_(body) {
  var out;
  try {
    requireSecret_(body.secret);
    var action = String(body.action || '');
    if (action === 'ping') {
      out = { status: 'Success', message: 'pong' };
    } else if (action === 'syncNow') {
      out = { status: 'Success', summary: syncAll() };
    } else if (action === 'createListSheet') {
      var listId = normText_(body.listId);
      if (!listId) throw new Error('listId required');
      var rows = sbRequest_('get', 'order_lists?id=eq.' + encodeURIComponent(listId) +
        '&select=id,name,description,image,status,display,source_spreadsheet_id,created_at');
      if (!rows.length) throw new Error('Order list not found: ' + listId);
      var result = syncList_(rows[0]);
      if (result.error) throw new Error(result.error);
      out = {
        status: 'Success',
        spreadsheetId: normText_(rows[0].source_spreadsheet_id),
        url: result.url
      };
    } else {
      throw new Error('Unknown action: ' + action);
    }
  } catch (err2) {
    out = { status: 'Error', message: String((err2 && err2.message) || err2) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
