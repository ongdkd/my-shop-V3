// ── STATE ──
var allLists = [], selectedSheetId = null, selectedSheetName = '';
var currentPanel = 'overview', modalSaveFn = null;
var pendingImg = {};   // { fieldId: base64string }
var currentProductsSheetId = null;
var productViewMode = 'grid'; // the table overflows phone screens; cards fit
var currentProductsCache = [];
var _changedStockRows = {}; // rowIndex → true when user edits a stock input

// SVG icons (defined once, reused everywhere)
var SVG_EDIT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
var SVG_TRASH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
var SVG_SEARCH = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
var SVG_CART = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
var PLACEHOLDER = 'https://www.svgrepo.com/show/508699/landscape-placeholder.svg';

// ── INIT ──
var _au = sessionStorage.getItem('_au') || '';

google.script.run.withSuccessHandler(function(email) {
  document.getElementById('userEmail').textContent = email || _au || 'ไม่ทราบ';
  document.getElementById('userAvatar').textContent = (email || _au || '?').charAt(0).toUpperCase();
}).getAdminEmail();

var logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.onclick = function() {
    localStorage.removeItem('_adminUser');
    localStorage.removeItem('_adminPass');
    sessionStorage.removeItem('_au');
    sessionStorage.removeItem('_ap');
    var done = function() { window.location.href = 'admin-login.html'; };
    if (window.__sbSignOut) { window.__sbSignOut().then(done, done); } else { done(); }
  };
}

// Mobile Sidebar Toggle Logic
var menuBtn = document.getElementById('menuBtn');
var sidebar = document.getElementById('sidebar');
var overlay = document.getElementById('sidebarOverlay');

function toggleSidebar() {
  if (sidebar.classList.contains('open')) {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    sidebar.classList.add('open');
    overlay.classList.add('open');
  }
}

if (menuBtn) menuBtn.onclick = toggleSidebar;
if (overlay) overlay.onclick = toggleSidebar;

var navItems = document.querySelectorAll('.nav-item[data-panel]');
for (var ni = 0; ni < navItems.length; ni++) {
  navItems[ni].onclick = (function(btn) {
    return function() { 
      switchPanel(btn.getAttribute('data-panel')); 
      // Auto-close sidebar on mobile after clicking a link
      if (window.innerWidth <= 850 && sidebar.classList.contains('open')) {
        toggleSidebar();
      }
    };
  })(navItems[ni]);
}
document.getElementById('modalCancel').onclick = closeModal;
var _modalMousedownTarget = null;
document.getElementById('modal').addEventListener('mousedown', function(e) { _modalMousedownTarget = e.target; });
document.getElementById('modal').addEventListener('mouseup', function(e) { if (e.target === this && _modalMousedownTarget === this) closeModal(); _modalMousedownTarget = null; });
document.getElementById('modalSave').onclick = function() { if (modalSaveFn) modalSaveFn(); };
// Escape closes the modal (or the mobile sidebar)
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  if (document.getElementById('imageActionPicker')) closeImageActionPicker();
  else if (document.getElementById('modal').classList.contains('open')) closeModal();
  else if (sidebar.classList.contains('open')) toggleSidebar();
});
// ── Hash routing — the URL mirrors the open panel (#/products, #/orders …)
// so a refresh keeps your place and the back button navigates panels ──
var VALID_PANELS = ['orderlists', 'orders', 'products', 'status', 'slips', 'restock', 'stock', 'history'];
function panelFromHash() {
  var h = (location.hash || '').replace(/^#\/?/, '');
  return VALID_PANELS.indexOf(h) !== -1 ? h : 'orderlists';
}
window.addEventListener('hashchange', function() {
  var p = panelFromHash();
  if (p !== currentPanel) switchPanel(p);
});

loadAllLists(function() { switchPanel(panelFromHash()); });

// ── HELPERS ──
var _toastTimer = null;
// action (optional): { label, onClick } — adds a button and keeps the toast up longer
function toast(msg, type, action) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = (type || 'success') + ' show';
  el.style.pointerEvents = action ? 'auto' : '';
  if (action) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = function() { el.classList.remove('show'); el.style.pointerEvents = ''; action.onClick(); };
    el.appendChild(b);
  }
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); el.style.pointerEvents = ''; _toastTimer = null; }, action ? 7000 : 3500);
}

// ── Beep — runs in parent window where AudioContext is already unlocked ──
var _beepCtx = null;
window.playBeep = function() {
  try {
    if (!_beepCtx) _beepCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_beepCtx.state === 'suspended') _beepCtx.resume();
    var t = _beepCtx.currentTime;

    // First tone — main beep (high sine, sharp attack, fast decay)
    var o1 = _beepCtx.createOscillator();
    var g1 = _beepCtx.createGain();
    o1.connect(g1); g1.connect(_beepCtx.destination);
    o1.type = 'sine';
    o1.frequency.value = 1720;
    g1.gain.setValueAtTime(0, t);
    g1.gain.linearRampToValueAtTime(0.6, t + 0.005);  // instant attack
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12); // fast decay
    o1.start(t);
    o1.stop(t + 0.12);

    // Second tone — subtle harmonic to give it body
    var o2 = _beepCtx.createOscillator();
    var g2 = _beepCtx.createGain();
    o2.connect(g2); g2.connect(_beepCtx.destination);
    o2.type = 'sine';
    o2.frequency.value = 3440;  // 2x harmonic
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.15, t + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o2.start(t);
    o2.stop(t + 0.08);
  } catch(e) {}
};
function fmt(n) { return new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(Number(n)||0); }
// Compact price for dense cards: ฿120, ฿1,250.50 (no ".00")
function baht(n) { return '฿' + (Number(n)||0).toLocaleString('th-TH',{maximumFractionDigits:2}); }
function el(id) { return document.getElementById(id); }
function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function setContent(html) { el('content').innerHTML = html; }
function setLoading() {
  var d = document.createElement('div');
  d.className = 'state-loading';
  var s2 = document.createElement('div'); s2.className = 'spinner'; d.appendChild(s2);
  d.appendChild(document.createTextNode(' กำลังโหลด...'));
  el('content').innerHTML = '';
  el('content').appendChild(d);
}
function setTopbar(title, sub, actionsHtml) {
  el('topbarTitle').textContent = title;
  el('topbarSub').textContent = sub || '';
  el('topbarActions').innerHTML = actionsHtml || '';
}

function makeOptionsField(fieldId, initialOptions) {
  // initialOptions: array or comma-string
  // Each option gets its own labeled row + barcode field
  // Parse "Name:barcode" or plain "Name" from initialOptions
  var opts = [];       // option display names
  var initBcs = [];    // initial barcodes per option

  var rawList = [];
  if (Array.isArray(initialOptions)) {
    rawList = initialOptions.filter(Boolean);
  } else if (typeof initialOptions === 'string' && initialOptions.trim()) {
    rawList = initialOptions.split(',').map(function(o){ return o.trim(); }).filter(Boolean);
  }
  rawList.forEach(function(raw) {
    var colonIdx = raw.indexOf(':');
    if (colonIdx !== -1) {
      opts.push(raw.substring(0, colonIdx).trim());
      initBcs.push(raw.substring(colonIdx + 1).trim());
    } else {
      opts.push(raw);
      initBcs.push('');
    }
  });

  var wrap = div('modal-field modal-full');
  wrap.style.margin = '0';

  var lbl = document.createElement('label');
  lbl.textContent = 'ตัวเลือกสินค้า (แต่ละตัวเลือกมีบาร์โค้ดของตัวเอง)';
  wrap.appendChild(lbl);

  // Hidden input that stores final "Name:barcode,..." string
  var hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.id = fieldId;

  // Hidden input that stores per-option barcodes separated by |
  var hiddenBarcodes = document.createElement('input');
  hiddenBarcodes.type = 'hidden';
  hiddenBarcodes.id = fieldId + '_barcodes';
  hiddenBarcodes.value = initBcs.join('|');

  // Container for per-option rows
  var optRows = document.createElement('div');
  optRows.id = fieldId + '_rows';
  optRows.style.cssText = 'display:flex;flex-direction:column;gap:14px;margin-bottom:10px;';

  // Add new option row
  function addOptRow(optName, barcodeVal, idx) {
    var rowNum = idx + 1;
    var paddedNum = rowNum < 10 ? '0' + rowNum : String(rowNum);
    var rowDiv = document.createElement('div');
    rowDiv.style.cssText = [
      'background:var(--surface-2);border:1.5px solid var(--border);',
      'border-radius:var(--radius-md);padding:12px 14px;position:relative;'
    ].join('');
    rowDiv.setAttribute('data-opt-idx', idx);

    // Header row: chip label + delete btn
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    var badge = document.createElement('span');
    badge.style.cssText = [
      'display:inline-flex;align-items:center;gap:6px;',
      'background:var(--primary-light,#ede9ff);color:var(--primary);',
      'border:1.5px solid var(--primary);border-radius:999px;',
      'padding:3px 12px;font-size:0.8rem;font-weight:700;'
    ].join('');
    badge.innerHTML = '&#x1F3F7; ตัวเลือก ' + paddedNum;

    var delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.innerHTML = '&times; ลบ';
    delBtn.style.cssText = [
      'padding:3px 10px;font-size:0.75rem;font-weight:600;font-family:var(--font);',
      'background:none;color:var(--error,#FF4757);',
      'border:1.5px solid var(--error,#FF4757);border-radius:999px;cursor:pointer;'
    ].join('');
    delBtn.onclick = function() {
      var i2 = parseInt(rowDiv.getAttribute('data-opt-idx'), 10);
      opts.splice(i2, 1);
      updateHidden();
      renderOptRows();
    };

    hdr.appendChild(badge); hdr.appendChild(delBtn);
    rowDiv.appendChild(hdr);

    // Name input — no per-option image here: shop products only store
    // "name:barcode" text, so an image picker would silently discard files.
    // (Per-option images live on warehouse items, which do persist them.)
    var nameRow = document.createElement('div');
    nameRow.style.cssText = 'margin-bottom:10px;';
    var nameCol = document.createElement('div'); nameCol.style.cssText = 'min-width:0;';
    var nameLabel = document.createElement('label');
    nameLabel.textContent = 'ชื่อตัวเลือก';
    nameLabel.style.cssText = 'font-size:0.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px;';
    var nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = optName || '';
    nameInp.placeholder = 'เช่น สีแดง, Size M, Version A';
    nameInp.style.cssText = 'width:100%;';
    nameInp.oninput = function() {
      opts[parseInt(rowDiv.getAttribute('data-opt-idx'), 10)] = nameInp.value.trim();
      updateHidden();
    };
    nameCol.appendChild(nameLabel); nameCol.appendChild(nameInp);
    nameRow.appendChild(nameCol);
    rowDiv.appendChild(nameRow);

    // Barcode field for this option
    var bcFieldId = fieldId + '_bc_' + idx;
    var bcLabel = document.createElement('label');
    bcLabel.textContent = 'บาร์โค้ดตัวเลือก ' + paddedNum;
    bcLabel.style.cssText = 'font-size:0.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:4px;';
    rowDiv.appendChild(bcLabel);

    var bcRow = document.createElement('div');
    bcRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
    var bcInp = document.createElement('input');
    bcInp.type = 'text';
    bcInp.id = bcFieldId;
    bcInp.value = barcodeVal || '';
    bcInp.placeholder = 'บาร์โค้ดสำหรับตัวเลือกนี้';
    bcInp.style.cssText = 'flex:1;min-width:120px;font-family:monospace;';
    bcInp.oninput = function() { updateHidden(); };

    // Camera scan button
    var scanBtn2 = document.createElement('button');
    scanBtn2.type = 'button';
    scanBtn2.innerHTML = '&#x1F4F7;';
    scanBtn2.title = 'สแกนบาร์โค้ด';
    scanBtn2.style.cssText = [
      'padding:9px 11px;font-size:0.75rem;font-weight:600;font-family:var(--font);',
      'background:var(--primary-light);color:var(--primary);',
      'border:1.5px solid var(--primary);border-radius:var(--radius-sm);cursor:pointer;'
    ].join('');
    scanBtn2.onclick = (function(inp2) { return function() {
      var scanToken2 = 'opt_bc_' + bcFieldId + '_' + Date.now();
      var popup2 = window.open('', 'opt_barcode_' + bcFieldId, 'width=420,height=600,resizable=yes');
      if (!popup2) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
      scanBtn2.innerHTML = '&#x23F9;'; scanBtn2.disabled = true;
      function resetScan2() { scanBtn2.innerHTML = '&#x1F4F7;'; scanBtn2.disabled = false; }
      function applyResult2(bc) {
        bc = String(bc || '').trim(); if (!bc) return;
        inp2.value = bc; updateHidden();
        generateBarcode(bc, bcFieldId);
        toast('สแกนได้: ' + bc, 'success');
        resetScan2();
        try { if (popup2 && !popup2.closed) popup2.close(); } catch(e) {}
      }
      window.__barcodeResultBridge = function(token, bc) {
        if (token !== scanToken2) return;
        applyResult2(bc);
        delete window.__barcodeResultBridge;
      };
      var popHtml = makeScannerPopupHtml(scanToken2);
      popup2.document.open(); popup2.document.write(popHtml); popup2.document.close();
      function onMsg2(e) {
        var d = e.data || {};
        if ((d.token === scanToken2) && (d.barcode || d.value)) {
          window.removeEventListener('message', onMsg2);
          delete window.__barcodeResultBridge;
          applyResult2(d.barcode || d.value);
        }
      }
      window.addEventListener('message', onMsg2);
      var chkPop2 = setInterval(function() {
        try {
          if (popup2 && !popup2.closed && popup2.__barcodeResult) {
            var res2 = String(popup2.__barcodeResult || '').trim();
            if (res2) { clearInterval(chkPop2); window.removeEventListener('message', onMsg2); delete window.__barcodeResultBridge; applyResult2(res2); popup2.close(); return; }
          }
          if (!popup2 || popup2.closed) { clearInterval(chkPop2); window.removeEventListener('message', onMsg2); delete window.__barcodeResultBridge; resetScan2(); }
        } catch(e2) { clearInterval(chkPop2); resetScan2(); }
      }, 250);
    }; })(bcInp);

    // Random barcode button
    var randBtn = document.createElement('button');
    randBtn.type = 'button';
    randBtn.innerHTML = '&#x1F3B2; สุ่ม';
    randBtn.title = 'สร้างบาร์โค้ดสุ่ม';
    randBtn.style.cssText = [
      'padding:9px 11px;font-size:0.75rem;font-weight:600;font-family:var(--font);',
      'background:var(--surface);color:var(--text-2);',
      'border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;'
    ].join('');
    randBtn.onclick = function() {
      // Find previous option barcode, increment from it; or generate fresh
      var myIdx = parseInt(rowDiv.getAttribute('data-opt-idx'), 10);
      var prevBc = '';
      if (myIdx > 0) {
        var prevInp3 = document.getElementById(fieldId + '_bc_' + (myIdx - 1));
        if (prevInp3 && prevInp3.value) prevBc = prevInp3.value;
      }
      var rand = prevBc ? nextBarcodeFromPrevious(prevBc) : generateRandomBarcode();
      bcInp.value = rand;
      updateHidden();
      generateBarcode(rand, bcFieldId);
    };

    // Auto-render barcode on input (no separate preview button)
    bcInp.addEventListener('input', function() {
      var v = bcInp.value.trim();
      if (v.length >= 4) {
        generateBarcode(v, bcFieldId);
        var bw = document.getElementById(bcFieldId + '_barcode');
        if (bw) bw.style.display = 'block';
      }
    });

    bcRow.appendChild(bcInp); bcRow.appendChild(scanBtn2); bcRow.appendChild(randBtn);
    rowDiv.appendChild(bcRow);

    // Barcode canvas — shows automatically when barcode typed/loaded
    var bcWrap = document.createElement('div');
    bcWrap.id = bcFieldId + '_barcode';
    bcWrap.className = 'bc-preview-wrap';
    bcWrap.style.display = barcodeVal ? 'block' : 'none';
    var bcCanvas = document.createElement('canvas');
    bcCanvas.id = bcFieldId + '_canvas';
    bcWrap.appendChild(bcCanvas);
    rowDiv.appendChild(bcWrap);

    if (barcodeVal) { setTimeout(function() { generateBarcode(barcodeVal, bcFieldId); }, 300); }

    return rowDiv;
  }

  function updateHidden() {
    // Collect per-option barcodes. Look inside optRows, not the document: on the
    // first render the rows aren't attached yet, and a document lookup found
    // nothing — which wiped every option barcode on save.
    var bcs = opts.map(function(_, i) {
      var inp2 = optRows.querySelector('[id="' + fieldId + '_bc_' + i + '"]');
      return inp2 ? inp2.value.trim() : '';
    });
    hiddenBarcodes.value = bcs.join('|');
    // Store as "Name:barcode" combined in hidden (this is what gets saved to sheet)
    hidden.value = opts.map(function(name, i) {
      var bc = bcs[i] || '';
      return bc ? (name + ':' + bc) : name;
    }).join(',');
  }

  function renderOptRows() {
    optRows.innerHTML = '';
    var currentBcs = (hiddenBarcodes.value || '').split('|');
    opts.forEach(function(opt, i) {
      var bc = currentBcs[i] !== undefined ? currentBcs[i] : (initBcs[i] || '');
      var row = addOptRow(opt, bc, i);
      optRows.appendChild(row);
    });
    updateHidden();
  }

  // Add new option button
  var addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.innerHTML = '&#x2B; เพิ่มตัวเลือกใหม่';
  addBtn.style.cssText = [
    'display:inline-flex;align-items:center;gap:6px;',
    'padding:9px 16px;font-size:0.8rem;font-weight:700;font-family:var(--font);',
    'background:var(--primary-light);color:var(--primary);',
    'border:1.5px solid var(--primary);border-radius:var(--radius-sm);cursor:pointer;',
    'width:100%;justify-content:center;'
  ].join('');
  addBtn.onclick = function() {
    opts.push('');
    renderOptRows();
  };

  wrap.appendChild(optRows);
  wrap.appendChild(addBtn);
  wrap.appendChild(hidden);
  wrap.appendChild(hiddenBarcodes);

  var hint = document.createElement('div');
  hint.style.cssText = 'font-size:0.73rem;color:var(--text-3);margin-top:6px;';
  hint.textContent = 'แต่ละตัวเลือกมีบาร์โค้ดแยกกัน • กด "สุ่ม" เพื่อสร้างบาร์โค้ดอัตโนมัติ';
  wrap.appendChild(hint);

  // Initial render
  renderOptRows();

  return wrap;
}

function generateRandomBarcode() {
  // 10 random digits + "00" suffix = 12 chars, ends in 00
  var num = '';
  for (var i = 0; i < 10; i++) num += Math.floor(Math.random() * 10);
  return num + '00';
}

function nextBarcodeFromPrevious(prevBarcode) {
  // Increment the numeric suffix of a barcode by 1, preserving pad width
  var s = String(prevBarcode || '').trim();
  if (!s) return generateRandomBarcode();
  var m = s.match(/^(.*?)(\d+)$/);
  if (!m) return s + '01';
  var base3 = m[1], num3 = parseInt(m[2], 10), padLen3 = m[2].length;
  return base3 + String(num3 + 1).padStart(padLen3, '0');
}

function autoFillOptionBarcodes(fieldId, baseId) {
  if (!baseId) return;
  var rows = document.querySelectorAll('#' + fieldId + '_rows > div[data-opt-idx]');
  for (var i = 0; i < rows.length; i++) {
    var bcInp = document.getElementById(fieldId + '_bc_' + i);
    if (bcInp && !bcInp.value.trim()) {
      if (i === 0) {
        // First option: baseId + "01"
        bcInp.value = baseId + '01';
      } else {
        // Subsequent: increment from previous
        var prevInp = document.getElementById(fieldId + '_bc_' + (i - 1));
        bcInp.value = prevInp ? nextBarcodeFromPrevious(prevInp.value) : baseId + String(i + 1).padStart(2, '0');
      }
    }
  }
}

/**
 * Now updateHidden() stores the combined "Name:barcode" format directly in the hidden input.
 * This function is kept for compatibility — the hidden input already has the right format.
 */
function packageOptionsWithBarcodes(optNames, optBarcodes) {
  // optNames already contains "Name:barcode,..." from updateHidden()
  // If it doesn't have barcodes (legacy), try to merge with optBarcodes
  if (!optBarcodes) return optNames || '';
  var names = (optNames || '').split(',').map(function(n){ return n.trim(); }).filter(Boolean);
  var bcs   = optBarcodes.split('|').map(function(b){ return b.trim(); });
  var hasBc = bcs.some(function(b){ return b; });
  if (!hasBc) return optNames || '';
  return names.map(function(n, i) {
    // If name already has colon (already packaged), return as-is
    if (n.indexOf(':') !== -1) return n;
    var bc = bcs[i] || '';
    return bc ? n + ':' + bc : n;
  }).join(',');
}

// ════════════════════════════════
// BARCODE FIELD (Scan + Generate)
// ════════════════════════════════
var _barcodeScanner = null;

function stopBarcodeScanner() {
  if (_barcodeScanner) {
    try { _barcodeScanner.stop(); } catch(e) {}
    _barcodeScanner = null;
  }
}

// Open the camera scanner popup and drop the result into `input`.
// onDone(value) runs after a successful scan.
function scanBarcodeInto(input, btn, onDone) {
  var tok = 'scan_' + Date.now();
  var pop = window.open('', 'barcode_scanner', 'width=420,height=600,resizable=yes');
  if (!pop) { toast('กรุณาอนุญาต Pop-up สำหรับหน้านี้แล้วลองใหม่', 'error'); return; }
  var label = btn.innerHTML; btn.innerHTML = '&#x23F9;'; btn.disabled = true;
  function reset() { btn.innerHTML = label; btn.disabled = false; }
  function apply(v) {
    v = String(v || '').trim(); reset(); if (!v) return;
    input.value = v; input.dispatchEvent(new Event('input', { bubbles: true }));
    toast('สแกนได้: ' + v, 'success');
    if (onDone) onDone(v);
  }
  window.__barcodeResultBridge = function(t, v) { if (t !== tok) return; delete window.__barcodeResultBridge; apply(v); try { pop.close(); } catch (e) {} };
  pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
  var ck = setInterval(function() {
    try {
      if (pop && !pop.closed && pop.__barcodeResult) { var v = pop.__barcodeResult; clearInterval(ck); delete window.__barcodeResultBridge; apply(v); pop.close(); return; }
      if (!pop || pop.closed) { clearInterval(ck); delete window.__barcodeResultBridge; reset(); }
    } catch (e) { clearInterval(ck); reset(); }
  }, 250);
}

// continuous: stay open and keep sending codes (bulk "scan in a row") until
// the user taps done; a code must leave the frame before it counts again
function makeScannerPopupHtml(scanToken, continuous) {
  return [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>สแกนบาร์โค้ด</title>',
    '<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"><\/script>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{background:#000;display:flex;flex-direction:column;',
    'height:100vh;font-family:sans-serif;color:#fff;overflow:hidden;}',
    '#reader{width:100%;flex:1;overflow:hidden;position:relative;}',
    '#reader video{width:100%!important;height:100%!important;object-fit:cover;}',
    '#reader canvas{display:none!important;}',
    '#reader__scan_region{border:none!important;box-shadow:none!important;}',
    '#reader__scan_region img{display:none!important;}',
    '#reader::after{content:"";position:absolute;top:50%;left:50%;',
    'transform:translate(-50%,-55%);width:280px;height:140px;',
    'border:3px solid #00C896;border-radius:8px;',
    'box-shadow:0 0 0 9999px rgba(0,0,0,0.45);pointer-events:none;}',
    '.bottom{width:100%;padding:16px 20px 28px;display:flex;flex-direction:column;',
    'align-items:center;gap:10px;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);}',
    '#status{font-size:0.82rem;color:#aaa;text-align:center;line-height:1.5;}',
    '#result{font-size:0.95rem;font-weight:700;color:#00C896;text-align:center;',
    'word-break:break-all;min-height:18px;}',
    '#cancelBtn{padding:11px 0;background:#FF4757;color:#fff;border:none;',
    'border-radius:10px;font-size:0.92rem;font-weight:600;cursor:pointer;width:100%;max-width:320px;}',
    '</style></head>',
    '<body style="display:flex;flex-direction:column;">',
    '<div id="reader" style="flex:1;"></div>',
    '<div class="bottom">',
    '  <div id="status">กำลังเปิดกล้อง...</div>',
    '  <div id="result"></div>',
    '  <button id="cancelBtn">' + (continuous ? 'เสร็จสิ้น' : 'ยกเลิก') + '</button>',
    '</div>',
    '<script>',
    'var scanner=null,hasScanned=false;',
    'var SCAN_TOKEN="' + scanToken + '";',
    'var CONTINUOUS=' + (continuous ? 'true' : 'false') + ',sentCount=0,lastSent="";',
    'function sendResult(text){',
    '  text=String(text||"").trim();',
    '  if(!text||hasScanned)return;',
    '  hasScanned=true;',
    '  try{if(window.opener&&window.opener.playBeep)window.opener.playBeep();}catch(e){}',
    '  document.getElementById("result").textContent="✓ "+text;',
    '  document.getElementById("status").textContent="สแกนสำเร็จ!";',
    '  window.__barcodeResult=text;',
    '  var sent=false;',
    '  try{if(window.opener&&window.opener.__barcodeResultBridge){',
    '    window.opener.__barcodeResultBridge(SCAN_TOKEN,text);sent=true;',
    '  }}catch(e){}',
    '  if(!sent){try{window.opener&&window.opener.postMessage(',
    '    {type:"BARCODE_SCANNED",token:SCAN_TOKEN,barcode:text,value:text},"*"',
    '  );}catch(e){}}',
    '  if(CONTINUOUS){',
    '    sentCount++;lastSent=text;',
    '    document.getElementById("status").textContent="สแกนแล้ว "+sentCount+" รายการ — สแกนชิ้นถัดไปได้เลย";',
    '    setTimeout(function(){hasScanned=false;},900);',
    '    return;',
    '  }',
    '  if(scanner){try{scanner.stop();}catch(e){}}',
    '  setTimeout(function(){window.close();},700);',
    '}',
    'var lastT="",streak=0;',
    'function startScanner(){',
    '  scanner=new Html5Qrcode("reader");',
    '  scanner.start(',
    '    {facingMode:"environment"},',
    '    {fps:15,disableFlip:true,',
    '     experimentalFeatures:{useBarCodeDetectorIfSupported:true},',
    '     videoConstraints:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}},',
    '     formatsToSupport:[',
    '       Html5QrcodeSupportedFormats.EAN_13,',
    '       Html5QrcodeSupportedFormats.EAN_8,',
    '       Html5QrcodeSupportedFormats.CODE_128,',
    '       Html5QrcodeSupportedFormats.CODE_39,',
    '       Html5QrcodeSupportedFormats.UPC_A,',
    '       Html5QrcodeSupportedFormats.UPC_E,',
    '       Html5QrcodeSupportedFormats.QR_CODE',
    '     ]},',
    /* accept only after two identical consecutive reads — a misread
       almost never produces the same wrong value twice */
    '    function(text){',
    '      text=String(text||"").trim();',
    '      if(!text||hasScanned)return;',
    '      if(text===lastT){streak++;}else{lastT=text;streak=1;if(text!==lastSent)lastSent="";}',
    '      if(streak<2||text===lastSent)return;',
    '      sendResult(text);',
    '    },',
    '    function(){if(!hasScanned)document.getElementById("status").textContent="เล็งกล้องไปที่บาร์โค้ด...";}',
    '  ).then(function(){',
    '    document.getElementById("status").textContent="เล็งกล้องไปที่บาร์โค้ด...";',
    '  }).catch(function(e){',
    '    document.getElementById("status").textContent="เปิดกล้องไม่ได้: กรุณาอนุญาตการใช้กล้อง";',
    '  });',
    '}',
    'document.getElementById("cancelBtn").onclick=function(){',
    '  if(scanner){try{scanner.stop();}catch(e){}}',
    '  window.close();',
    '};',
    'window.addEventListener("load",function(){startScanner();});',
    '<\/script></body></html>'
  ].join('');
}

function generateBarcode(value, fieldId) {
  var barcodeWrap = el(fieldId + '_barcode');
  var canvas = el(fieldId + '_canvas');
  if (!barcodeWrap || !canvas) return;

  function doGenerate() {
    try {
      JsBarcode(canvas, value, {
        format: 'CODE128',   // CODE128 accepts any alphanumeric string
        width: 2,
        height: 80,
        displayValue: true,
        fontSize: 14,
        margin: 10,
        background: '#ffffff',
        lineColor: '#1A1D3A'
      });

      // Show the barcode as a real <img> — canvases can't be long-press
      // saved on mobile — plus an explicit download button.
      var dataUrl = canvas.toDataURL('image/png');
      canvas.style.display = 'none';

      var img = barcodeWrap.querySelector('.bc-img');
      if (!img) {
        img = document.createElement('img');
        img.className = 'bc-img';
        img.alt = 'barcode';
        img.style.cssText = 'max-width:100%;display:block;margin:0 auto;';
        canvas.parentNode.insertBefore(img, canvas);
      }
      img.src = dataUrl;

      var dlBtn = barcodeWrap.querySelector('.bc-dl-btn');
      if (!dlBtn) {
        dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'bc-dl-btn';
        dlBtn.innerHTML = '&#x2B07; บันทึกรูปบาร์โค้ด';
        dlBtn.style.cssText = 'display:block;margin:8px auto 0;padding:6px 16px;font-size:0.75rem;font-weight:700;font-family:var(--font);background:var(--surface);color:var(--text-2);border:1.5px solid var(--border-strong);border-radius:999px;cursor:pointer;';
        barcodeWrap.appendChild(dlBtn);
      }
      dlBtn.onclick = function(e) {
        e.preventDefault(); e.stopPropagation();
        var a = document.createElement('a');
        a.href = img.src;
        a.download = 'barcode_' + String(value).replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
      };

      barcodeWrap.style.display = 'block';
    } catch(e) {
      toast('ไม่สามารถสร้างบาร์โค้ดได้: ตรวจสอบ ID อีกครั้ง', 'error');
    }
  }

  if (!window.JsBarcode) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
    script.onload = doGenerate;
    document.head.appendChild(script);
  } else {
    doGenerate();
  }
}

function openModal(title, bodyHtml, saveFn, saveLabel) {
  el('modalTitle').innerHTML = title;

  if (bodyHtml) {
    el('modalBody').innerHTML = bodyHtml;
  }

  // Always reset the save button — a previous flow that disabled it
  // must never leave the next modal stuck unsaveable
  el('modalSave').textContent = saveLabel || 'บันทึก';
  el('modalSave').className = 'btn btn-primary';
  el('modalSave').disabled = false;
  el('modalSave').hidden = !saveFn; // view-only windows close with ยกเลิก
  el('modalSaveNext').hidden = true; // opt-in per modal
  el('modalSaveNext').disabled = false;
  modalSaveFn = saveFn;
  el('modal').classList.add('open');
}
function closeModal() {
  el('modal').classList.remove('open');
  modalSaveFn = null;
  pendingImg = {};
}

function switchPanel(panel) {
  currentPanel = panel;
  // Keep the URL in sync; replace on first load so back exits cleanly
  if (location.hash !== '#/' + panel) {
    if (!location.hash) history.replaceState(null, '', '#/' + panel);
    else location.hash = '#/' + panel;
  }
  var items = document.querySelectorAll('.nav-item[data-panel]');
  for (var i = 0; i < items.length; i++) {
    items[i].className = items[i].getAttribute('data-panel') === panel ? 'nav-item active' : 'nav-item';
  }
  if (panel === 'orderlists') renderOrderLists();
  else if (panel === 'orders')     renderOrdersPanel();
  else if (panel === 'slips')      renderSlipsPanel();
  else if (panel === 'status')     renderStatusPanel();
  else if (panel === 'products')   renderProductsPanel();
  else if (panel === 'restock')    renderRestockPanel();
  else if (panel === 'stock')      renderStockPanel();
  else if (panel === 'history')    renderHistoryPanel();
}
function loadAllLists(cb) {
  google.script.run.withSuccessHandler(function(r) {
    try { var res = JSON.parse(r); if (res.status === 'Success') allLists = res.rows || []; } catch(e) {}
    if (cb) cb();
  }).adminGetOrderLists();
}

// ── BUILD HELPERS — avoid quotes inside strings ──
function div(cls, content) {
  var d = document.createElement('div');
  if (cls) d.className = cls;
  if (content) d.innerHTML = content;
  return d;
}
function makeBtn(cls, label, onclick) {
  var b = document.createElement('button');
  b.className = cls; b.innerHTML = label;
  if (onclick) b.onclick = onclick;
  return b;
}
// In-page yes/no box, resolving true/false. Used instead of the browser's confirm(),
// which some embedded browsers block (it answers "no" at once, so buttons silently did nothing)
function askConfirm(msg, okLabel) {
  return new Promise(function(resolve) {
    var ov = div('ask-overlay'); ov.setAttribute('role', 'alertdialog'); ov.setAttribute('aria-modal', 'true');
    var box = div('ask-box');
    var p = div('ask-msg'); p.textContent = msg; box.appendChild(p);
    var row = div('ask-actions');
    function done(v) { document.removeEventListener('keydown', key, true); ov.remove(); resolve(v); }
    function key(e) { if (e.key === 'Escape') { e.stopPropagation(); done(false); } }
    var no = makeBtn('btn btn-ghost', 'ยกเลิก', function() { done(false); }); no.type = 'button';
    var yes = makeBtn('btn btn-primary', escapeHtml(okLabel || 'ยืนยัน'), function() { done(true); }); yes.type = 'button';
    row.appendChild(no); row.appendChild(yes); box.appendChild(row); ov.appendChild(box);
    ov.onclick = function(e) { if (e.target === ov) done(false); };
    document.addEventListener('keydown', key, true);
    document.body.appendChild(ov); yes.focus();
  });
}
function makeSpinner() {
  var w = document.createElement('div'); w.className = 'state-loading';
  var s = document.createElement('div'); s.className = 'spinner';
  w.appendChild(s); w.appendChild(document.createTextNode(' กำลังโหลด...'));
  return w;
}

function makeStat(label, value, cls) {
  var chip = div('stat-chip');
  var lbl = div('stat-chip-label'); lbl.textContent = label; chip.appendChild(lbl);
  var val = div('stat-chip-value' + (cls ? ' ' + cls : '')); val.textContent = value; chip.appendChild(val);
  return chip;
}

// Admin pickers list every order list: "Hide" only hides it from customers.
// Open first, hidden last; otherwise keeps the original order.
function getVisibleLists() {
  function rank(l) {
    var d = String(l.display).toLowerCase();
    var hidden = d === 'hidden' || d === 'hide' || d === 'false' || d === 'no';
    return (hidden ? 2 : 0) + (l.status === 'Open' ? 0 : 1);
  }
  return allLists.slice().sort(function(a, b) { return rank(a) - rank(b); });
}

// ════════════════════════════════
// BACKUP / EXPORT
// ════════════════════════════════
function csvCell(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadTextFile(name, text, mime) {
  var blob = new Blob([text], { type: mime + ';charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
}

// Fetches every table and builds the two backup files:
// { json: {name, text}, csv: {name, text}, summary }
function buildBackupFiles(done, fail) {
  google.script.run.withSuccessHandler(function(r) {
    var res; try { res = JSON.parse(r); } catch(e) { return fail('สำรองข้อมูลไม่สำเร็จ'); }
    if (res.status !== 'Success') return fail(res.message || 'สำรองข้อมูลไม่สำเร็จ');
    var d = res.data || {};
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0');

    var listName = {};
    (d.order_lists || []).forEach(function(l) { listName[l.id] = l.name; });
    var head = ['วันที่', 'รายการ', 'ลูกค้า', 'สินค้า', 'จำนวน', 'ประเภท',
                'ราคา/ชิ้น', 'รวม', 'หยวน', 'รวมหยวน', 'ราคาเต็ม', 'รวมราคาเต็ม', 'เบอร์/หมายเหตุ'];
    var lines = [head.join(',')];
    (d.orders || []).forEach(function(o) {
      lines.push([
        o.created_at, listName[o.list_id] || '', o.customer, o.product, o.qty, o.pay_type,
        o.price, o.total, o.yuan, o.total_yuan, o.full_price, o.total_full, o.remark
      ].map(csvCell).join(','));
    });
    done({
      json: { name: 'orderhub-backup-' + stamp + '.json', text: JSON.stringify({ exportedAt: res.exportedAt, data: d }, null, 1) },
      // UTF-8 BOM so Thai text opens correctly in Excel
      csv: { name: 'orderhub-orders-' + stamp + '.csv', text: '﻿' + lines.join('\r\n') },
      summary: 'รายการ ' + (d.order_lists || []).length +
               ' / สินค้า ' + (d.products || []).length +
               ' / ออเดอร์ ' + (d.orders || []).length +
               ' / คลัง ' + (d.stock_items || []).length
    });
  }).withFailureHandler(function() { fail('สำรองข้อมูลไม่สำเร็จ — กรุณาลองใหม่'); }).adminExportAllData();
}

function exportBackup(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังสำรอง...'; }
  function restoreBtn() { if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F4BE; สำรองข้อมูล'; } }
  buildBackupFiles(function(f) {
    restoreBtn();
    downloadTextFile(f.json.name, f.json.text, 'application/json');
    // Slight delay so browsers allow the second download
    setTimeout(function() { downloadTextFile(f.csv.name, f.csv.text, 'text/csv'); }, 500);
    toast('สำรองข้อมูลแล้ว: ' + f.summary, 'success');
  }, function(msg) { restoreBtn(); toast(msg, 'error'); });
}

// ── Backups kept in Supabase ──
// pg_cron takes a snapshot every night (newest 30 kept, see schema.sql);
// this window takes one now, downloads any snapshot, or downloads live data
function backupStamp(iso) {
  var d = new Date(iso);
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
    '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
}
function openBackupsModal() {
  openModal('&#x1F4BE; สำรองข้อมูล', '<div class="bk-wrap"><p class="bk-note">ระบบสำรองให้อัตโนมัติทุกคืน 03:00 (เก็บ 30 ครั้งล่าสุดใน Supabase)</p><div class="bk-acts"></div><div class="bk-list">กำลังโหลด...</div></div>',
    null);
  var acts = el('modalBody').querySelector('.bk-acts');
  var nowBtn = makeBtn('btn btn-primary btn-sm', 'สำรองตอนนี้', function() {
    nowBtn.disabled = true; nowBtn.textContent = 'กำลังสำรอง...';
    google.script.run.withSuccessHandler(function(r) {
      nowBtn.disabled = false; nowBtn.textContent = 'สำรองตอนนี้';
      var res = JSON.parse(r);
      if (res.status !== 'Success') { toast(res.message || 'สำรองไม่สำเร็จ', 'error'); return; }
      toast('สำรองแล้ว', 'success'); loadBackupList();
    }).withFailureHandler(function() { nowBtn.disabled = false; nowBtn.textContent = 'สำรองตอนนี้'; toast('สำรองไม่สำเร็จ', 'error'); }).adminTakeBackup();
  });
  var dlBtn = makeBtn('btn btn-ghost btn-sm', '&#x2B07; ดาวน์โหลดข้อมูลล่าสุด (JSON + CSV)', function() { exportBackup(null); });
  acts.appendChild(nowBtn); acts.appendChild(dlBtn);
  loadBackupList();
}
function loadBackupList() {
  var list = el('modalBody').querySelector('.bk-list'); if (!list) return;
  google.script.run.withSuccessHandler(function(r) {
    var res; try { res = JSON.parse(r); } catch(e) { res = {}; }
    list.innerHTML = '';
    if (res.status !== 'Success') { list.appendChild(div('bk-note bk-warn', '')).textContent = res.message || 'โหลดไม่สำเร็จ'; return; }
    if (!res.backups.length) { list.appendChild(div('bk-note', 'ยังไม่มีข้อมูลสำรอง — กด "สำรองตอนนี้"')); return; }
    res.backups.forEach(function(b) {
      var s = b.summary || {};
      var row = div('bk-row');
      var info = div('bk-info');
      info.appendChild(div('bk-date')).textContent = new Date(b.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
      info.appendChild(div('bk-sum')).textContent = 'รายการ ' + (s.order_lists || 0) + ' · สินค้า ' + (s.products || 0) + ' · ออเดอร์ ' + (s.orders || 0) + ' · คลัง ' + (s.stock_items || 0);
      var get = makeBtn('btn btn-ghost btn-sm', '&#x2B07; JSON', function() {
        get.disabled = true;
        google.script.run.withSuccessHandler(function(r2) {
          get.disabled = false;
          var d = JSON.parse(r2);
          if (d.status !== 'Success') { toast(d.message || 'ดาวน์โหลดไม่สำเร็จ', 'error'); return; }
          downloadTextFile('orderhub-backup-' + backupStamp(d.exportedAt) + '.json',
            JSON.stringify({ exportedAt: d.exportedAt, data: d.data }, null, 1), 'application/json');
        }).withFailureHandler(function() { get.disabled = false; toast('ดาวน์โหลดไม่สำเร็จ', 'error'); }).adminGetBackup(b.id);
      });
      get.setAttribute('aria-label', 'ดาวน์โหลดข้อมูลสำรอง ' + info.firstChild.textContent);
      row.appendChild(info); row.appendChild(get); list.appendChild(row);
    });
  }).withFailureHandler(function() { list.textContent = 'โหลดไม่สำเร็จ'; }).adminListBackups();
}

// ════════════════════════════════
// ORDER LISTS (Combined with Overview)
// ════════════════════════════════
function renderOrderLists() {
  setTopbar('ภาพรวม', allLists.length + ' รายการ');
  el('topbarActions').innerHTML = '';
  var nb = makeBtn('btn btn-primary btn-sm', '&#x2B; สร้างรายการใหม่', openCreateOrderListModal);
  var ob = makeBtn('btn btn-ghost btn-sm', '&#x1F6D2; เปิดหน้าสั่งซื้อ', function() {
    google.script.run.withSuccessHandler(function(url) {
      window.open(url, '_blank'); 
    }).getWebAppUrl();
  });
  var rb = makeBtn('btn btn-ghost btn-sm', '&#x21BB; รีเฟรช', function() { loadAllLists(renderOrderLists); });
  rb.style.marginLeft = '6px';
  var bb = makeBtn('btn btn-ghost btn-sm', '&#x1F4BE; สำรองข้อมูล', openBackupsModal);
  bb.title = 'สำรองอัตโนมัติทุกคืน · สำรองตอนนี้ · ดาวน์โหลด';
  el('topbarActions').appendChild(nb); el('topbarActions').appendChild(ob); el('topbarActions').appendChild(rb); el('topbarActions').appendChild(bb);
 
  var wrap = document.createElement('div');
 
  // --- 1. STATS ROW ---
  var openCount = 0;
  for (var i = 0; i < allLists.length; i++) if (allLists[i].status === 'Open') openCount++;
  var closedCount = allLists.length - openCount;
 
  var statRow = div('stat-row');
  statRow.appendChild(makeStat('รายการทั้งหมด', allLists.length, ''));
  statRow.appendChild(makeStat('เปิดรับอยู่', openCount, 'success'));
  statRow.appendChild(makeStat('ปิดรับแล้ว', closedCount, ''));
  wrap.appendChild(statRow);
 
  // --- 2. ORDER LIST GRID ---
  if (!allLists.length) {
    var empty = div('state-empty', '&#x1F4C2; ยังไม่มีรายการค่ะ');
    var cb = makeBtn('btn btn-primary', '&#x2B; สร้างรายการแรก', openCreateOrderListModal);
    cb.style.marginTop = '12px'; empty.appendChild(cb);
    wrap.appendChild(empty);
    el('content').innerHTML = ''; el('content').appendChild(wrap);
    return;
  }
 
  // FIX 1: Sort — Open & visible first, Closed next, Hidden last
  var sortedLists = allLists.slice().sort(function(a, b) {
    var aHidden = ['hidden','hide','false','no'].indexOf(String(a.display).toLowerCase()) !== -1;
    var bHidden = ['hidden','hide','false','no'].indexOf(String(b.display).toLowerCase()) !== -1;
    if (aHidden !== bHidden) return aHidden ? 1 : -1;           // hidden sinks to bottom
    if (a.status !== b.status) return a.status === 'Open' ? -1 : 1; // Open floats to top
    return 0;
  });
 
  var grid = div('ol-grid'); grid.id = 'olGrid';
  for (var i = 0; i < sortedLists.length; i++) {
    var item = sortedLists[i];
    var isOpen = item.status === 'Open';
    var isHidden = ['hidden','hide','false','no'].indexOf(String(item.display).toLowerCase()) !== -1;
 
    var card = div('ol-card'); card.setAttribute('data-row', item.rowIndex);
    if (isHidden) card.style.opacity = '0.55';
 
    var img = document.createElement('img');
    img.src = item.image || PLACEHOLDER; img.className = 'ol-card-img';
    img.onerror = function() { this.src = PLACEHOLDER; };
    card.appendChild(img);
 
    var body = div('ol-card-body');
    var name = div('ol-card-name'); name.textContent = item.name; body.appendChild(name);
    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:0.74rem;color:var(--text-3);margin-bottom:2px;';
    desc.textContent = item.desc || 'ไม่มีคำอธิบาย'; body.appendChild(desc);
 
    var navRow = document.createElement('div');
    navRow.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:12px;margin-bottom:12px;';
 
    var posBtn = makeBtn('btn btn-primary btn-sm', '&#x1F5A5;&#xFE0F; เปิดโหมด POS', (function(it) {
      return function() { openPOSMode(it); };
    })(item));
    posBtn.style.cssText = 'justify-content:center;width:100%;';
    navRow.appendChild(posBtn);
 
    var subRow = document.createElement('div');
    subRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;';
 
    var prodBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F4E6; ดูสินค้า', (function(it) {
      return function() { selectedSheetId = it.sheetId; selectedSheetName = it.name; switchPanel('products'); };
    })(item));
    prodBtn.style.cssText = 'justify-content:center;min-width:0;width:100%;';
 
    var orderBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; คำสั่งซื้อ', (function(it) {
      return function() { selectedSheetId = it.sheetId; selectedSheetName = it.name; switchPanel('orders'); };
    })(item));
    orderBtn.style.cssText = 'justify-content:center;min-width:0;width:100%;';
 
    var shopBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F517; เปิดชีต', (function(it) {
      return function() { if (!it.url) { toast('ไม่พบลิงก์ร้านค้า', 'error'); return; } window.open(it.url, '_blank'); };
    })(item));
    shopBtn.style.cssText = 'justify-content:center;min-width:0;width:100%;';
 
    subRow.appendChild(prodBtn);
    subRow.appendChild(orderBtn);
    subRow.appendChild(shopBtn);
    navRow.appendChild(subRow);

    // Sync button — only for lists that were imported from a Google Sheet
    if (item.sourceSpreadsheetId) {
      var syncBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F504; ซิงก์สินค้าจากชีต', (function(it) {
        return function() { openSyncSheetModal(it); };
      })(item));
      syncBtn.style.cssText = 'justify-content:center;width:100%;';
      navRow.appendChild(syncBtn);
    }
    body.appendChild(navRow);
 
    // Bottom Row: Toggle + icon buttons
    var row = div('ol-card-row');
    row.style.borderTop = '1px dashed var(--border)';
    row.style.paddingTop = '12px';
 
    var tw = div('toggle-wrap');
    var lbl = document.createElement('span'); lbl.className = 'tlbl'; lbl.textContent = isOpen ? 'เปิดรับ' : 'ปิดรับ';
    var tLabel = document.createElement('label'); tLabel.className = 'toggle';
    var chk = document.createElement('input'); chk.type = 'checkbox'; chk.className = 'ol-tog';
    chk.setAttribute('data-row', item.rowIndex); if (isOpen) chk.checked = true;
    var slider = document.createElement('span'); slider.className = 'toggle-slider';
    tLabel.appendChild(chk); tLabel.appendChild(slider);
    tw.appendChild(lbl); tw.appendChild(tLabel); row.appendChild(tw);
 
    var btnWrap = document.createElement('div'); btnWrap.style.cssText = 'display:flex;gap:5px;';
 
    var hideBtn = makeBtn('btn-icon ol-hide', isHidden ? '&#x1F441;&#xFE0F;' : '&#x1F576;&#xFE0F;');
    hideBtn.title = isHidden ? 'เลิกซ่อน (แสดง)' : 'ซ่อนรายการ';
    hideBtn.setAttribute('data-row', item.rowIndex);
    if (isHidden) hideBtn.style.cssText = 'color:var(--warning);border-color:var(--warning);';
 
    var editBtn = makeBtn('btn-icon ol-edit', SVG_EDIT); editBtn.title = 'แก้ไข'; editBtn.setAttribute('data-row', item.rowIndex);
    var delBtn  = makeBtn('btn-icon ol-del',  SVG_TRASH); delBtn.title  = 'ลบ';   delBtn.setAttribute('data-row',  item.rowIndex);
    delBtn.style.cssText = 'color:var(--error);border-color:var(--error);';
 
    btnWrap.appendChild(hideBtn); btnWrap.appendChild(editBtn); btnWrap.appendChild(delBtn);
    row.appendChild(btnWrap); body.appendChild(row); card.appendChild(body);
    grid.appendChild(card);
  }
 
  wrap.appendChild(grid);
  el('content').innerHTML = ''; el('content').appendChild(wrap);

  // Order of the cards = order customers see on the shop page
  enableReorder(grid.children, sortedLists.map(function(l) { return l.rowIndex; }), function(order) {
    grid.classList.add('busy');
    apiCall('adminReorderOrderLists', order).then(function(res) {
      grid.classList.remove('busy');
      if (res.status !== 'Success') { toast(res.message || 'จัดลำดับไม่สำเร็จ', 'error'); return; }
      toast('บันทึกลำดับแล้ว', 'success'); loadAllLists(renderOrderLists);
    });
  }, function(card) { var bar = div('reorder-bar'); card.appendChild(bar); return bar; });

  grid.onchange = function(e) {
    var tog = e.target.closest('.ol-tog'); if (!tog) return;
    var row = parseInt(tog.getAttribute('data-row'), 10);
    var lbl2 = tog.closest('.toggle-wrap').querySelector('.tlbl');
    toggleListStatus(row, tog, lbl2);
  };
  grid.onclick = function(e) {
    var hb = e.target.closest('.ol-hide');
    if (hb) {
      var row = parseInt(hb.getAttribute('data-row'), 10);
      hb.disabled = true; hb.style.opacity = '0.5';
      google.script.run.withSuccessHandler(function(r) {
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') { toast('อัปเดตการแสดงผลแล้ว', 'success'); loadAllLists(renderOrderLists); }
          else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); hb.disabled = false; hb.style.opacity = '1'; }
        } catch(ex) { toast('เกิดข้อผิดพลาด', 'error'); hb.disabled = false; hb.style.opacity = '1'; }
      }).adminToggleDisplay(row);
      return;
    }
    var eb = e.target.closest('.ol-edit');
    if (eb) {
      var row = parseInt(eb.getAttribute('data-row'), 10);
      for (var j = 0; j < allLists.length; j++) { if (allLists[j].rowIndex === row) { editOrderListRow(allLists[j]); break; } }
      return;
    }
    var db = e.target.closest('.ol-del');
    if (db) {
      var row = parseInt(db.getAttribute('data-row'), 10);
      for (var j = 0; j < allLists.length; j++) { if (allLists[j].rowIndex === row) { confirmDeleteOrderList(allLists[j]); break; } }
    }
  };
}

function toggleListStatus(rowIndex, checkbox, lbl) {
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        var isOpen = res.newStatus === 'Open';
        if (lbl) lbl.textContent = isOpen ? 'เปิดรับ' : 'ปิดรับ';
        for (var i = 0; i < allLists.length; i++) {
          if (allLists[i].rowIndex === rowIndex) { allLists[i].status = res.newStatus; break; }
        }
        toast(isOpen ? 'เปิดรับออเดอร์แล้ว' : 'ปิดรับออเดอร์แล้ว', 'success');
      } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); checkbox.checked = !checkbox.checked; }
    } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); checkbox.checked = !checkbox.checked; }
  }).adminToggleStatus(rowIndex);
}

// ── Free-gift editor for one order list ──
//   (●) ได้ทุกชิ้นที่ถึง  ( ) ได้ 1 ชิ้นที่ดีที่สุด
//   [Sticker        ] [¥▼][ 188 ][ ∞ ] ×
//   [Poster         ] [¥▼][ 288 ][ 20 ] ×
//   + เพิ่มของแถม
// Returns { el, rules(), mode(), changed(), error() }.
function buildGiftEditor(item) {
  var rules = (item.giftRules || []).map(function(g) { return { id: g.id, name: g.name, min: g.min, currency: g.currency, stock: g.stock }; });
  var mode = item.giftMode === 'best' ? 'best' : 'all';
  var start = JSON.stringify([rules, mode]);
  var box = fkMore('ของแถมตามยอดซื้อ' + (rules.length ? ' · ' + rules.length + ' รายการ' : ''), rules.length > 0);
  box.classList.add('gift-ed');
  var body = div('gift-ed-body'); box.appendChild(body);

  function draw() {
    body.innerHTML = '';
    if (!item.giftsReady) {
      body.appendChild(div('gift-ed-note warn', 'ต้องอัปเดตฐานข้อมูลก่อน: รันไฟล์ supabase/schema.sql ใน Supabase → SQL Editor แล้วรีเฟรชหน้านี้'));
      return;
    }
    var seg = div('ord-seg');
    [['all', 'ได้ทุกชิ้นที่ถึง'], ['best', 'ได้ 1 ชิ้นที่ดีที่สุด']].forEach(function(m) {
      var b = makeBtn('ord-seg-btn' + (mode === m[0] ? ' on' : ''), m[1], function() { mode = m[0]; draw(); });
      b.type = 'button'; b.setAttribute('aria-pressed', mode === m[0] ? 'true' : 'false'); seg.appendChild(b);
    });
    body.appendChild(seg);
    body.appendChild(div('gift-ed-note', mode === 'best'
      ? 'ลูกค้าได้ของแถม 1 ชิ้น: ข้อที่อยู่ล่างสุดที่ยอดถึง (เรียงจากยอดน้อยไปมาก)'
      : 'ลูกค้าได้ของแถมทุกข้อที่ยอดซื้อในบิลนั้นถึง'));
    rules.forEach(function(g, i) {
      var row = div('gift-ed-row');
      var nm = fkInput('', 'text', g.name, 'ชื่อของแถม เช่น สติกเกอร์'); nm.removeAttribute('id');
      nm.setAttribute('aria-label', 'ชื่อของแถมข้อ ' + (i + 1)); nm.oninput = function() { g.name = nm.value; };
      row.appendChild(nm);
      var line = div('gift-ed-line');
      var cur = document.createElement('select'); cur.className = 'bcard-input gift-ed-cur'; cur.setAttribute('aria-label', 'สกุลเงิน');
      cur.innerHTML = '<option value="CNY">¥ หยวน</option><option value="THB">฿ บาท</option>'; cur.value = g.currency === 'CNY' ? 'CNY' : 'THB';
      cur.onchange = function() { g.currency = cur.value; };
      var mn = fkInput('', 'number', g.min, 'ยอดขั้นต่ำ'); mn.removeAttribute('id'); mn.setAttribute('aria-label', 'ยอดขั้นต่ำข้อ ' + (i + 1));
      mn.oninput = function() { g.min = mn.value; };
      var sk = fkInput('', 'number', g.stock === null || g.stock === undefined ? '' : g.stock, '∞ จำนวน'); sk.removeAttribute('id'); sk.inputMode = 'numeric';
      sk.setAttribute('aria-label', 'จำนวนของแถมข้อ ' + (i + 1) + ' (ว่าง = ไม่จำกัด)');
      sk.oninput = function() { g.stock = sk.value === '' ? null : sk.value; };
      var del = makeBtn('bopt-del', '&#x2715;', function() { rules.splice(i, 1); draw(); }); del.type = 'button'; del.setAttribute('aria-label', 'ลบของแถมข้อ ' + (i + 1));
      line.appendChild(cur); line.appendChild(mn); line.appendChild(sk); line.appendChild(del);
      row.appendChild(line);
      body.appendChild(row);
    });
    var add = makeBtn('bopt-add', '+ เพิ่มของแถม', function() {
      var last = rules[rules.length - 1];
      rules.push({ id: '', name: '', min: '', currency: last ? last.currency : 'CNY', stock: null }); draw();
      var inputs = body.querySelectorAll('.gift-ed-row input[type=text]'); if (inputs.length) inputs[inputs.length - 1].focus();
    });
    add.type = 'button'; body.appendChild(add);
  }
  draw();
  return {
    el: box,
    rules: function() { return rules; },
    mode: function() { return mode; },
    changed: function() { return JSON.stringify([rules, mode]) !== start; },
    error: function() {
      for (var i = 0; i < rules.length; i++) {
        if (!String(rules[i].name || '').trim()) return 'ของแถมข้อ ' + (i + 1) + ': กรุณาใส่ชื่อ';
        if (!(Number(rules[i].min) > 0)) return 'ของแถมข้อ ' + (i + 1) + ': กรุณาใส่ยอดขั้นต่ำ';
        if (rules[i].stock !== null && rules[i].stock !== '' && !(Number(rules[i].stock) >= 0)) return 'ของแถมข้อ ' + (i + 1) + ': จำนวนไม่ถูกต้อง';
      }
      return '';
    }
  };
}

function editOrderListRow(item) {
  // Same language as the product editors:
  //   [ wide cover photo — tap to change ]
  //   ชื่อรายการ [……………]   (read-only for lists linked to a Google Sheet)
  //   คำอธิบาย  [……………]
  //   ▸ ของแถมตามยอดซื้อ
  el('modalBody').innerHTML = '';
  var form = div('epform'); el('modalBody').appendChild(form);
  var canRename = !String(item.sourceSpreadsheetId || '').trim();

  // Cover: a picked file waits in pendingImg.mImage (uploaded on save by
  // resolveImage); a picked URL goes into the hidden #mImage
  delete pendingImg.mImage; // a photo picked in a cancelled edit must not upload here
  var coverUrl = document.createElement('input'); coverUrl.type = 'hidden'; coverUrl.id = 'mImage'; coverUrl.value = item.image || '';
  var cover = makeBulkImgBox('mImage', item.image || '', function(v) { if (!/^__pending__/.test(v)) coverUrl.value = v; });
  cover.el.classList.add('cover-img'); cover.el.title = 'แตะเพื่อเปลี่ยนรูปปก (กล้อง / ไฟล์ / ลิงก์)';
  var coverField = fkField('รูปปก', cover.el); coverField.appendChild(coverUrl);
  form.appendChild(coverField);

  // Lists created in the web app own their name; imported lists keep the
  // spreadsheet title as their source of truth, so it is read-only here
  var ni = fkInput('mName', 'text', item.name || '', 'ชื่อรายการ');
  var nameField = fkField('ชื่อรายการ', ni, 'mName');
  if (!canRename) {
    ni.readOnly = true; ni.classList.add('is-locked'); ni.title = 'ชื่อรายการนี้มาจาก Google Sheet';
    nameField.appendChild(div('ep-hint', 'เชื่อมกับ Google Sheet — เปลี่ยนชื่อที่ชีตต้นทาง'));
  }
  form.appendChild(nameField);
  form.appendChild(fkField('คำอธิบาย', fkInput('mDesc', 'text', item.desc || '', 'เช่น รับถึงวันศุกร์นี้ค่ะ'), 'mDesc'));

  // Free gifts by spend
  var gifts = buildGiftEditor(item);
  form.appendChild(gifts.el);

  openModal('&#x270F;&#xFE0F; แก้ไขรายการสั่งซื้อ', '', function() {
    var giftErr = gifts.error();
    if (giftErr) { toast(giftErr, 'error'); return; }
    var newName = canRename ? el('mName').value.trim() : null;
    if (canRename && !newName) { toast('กรุณากรอกชื่อรายการ', 'error'); el('mName').focus(); return; }
    var d = el('mDesc').value;
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...';
    resolveImage('mImage', function(imgUrl) {
      var finalImage = imgUrl || item.image || '';
      google.script.run.withSuccessHandler(function(r) {
        saveBtn.disabled = false; saveBtn.textContent = 'บันทึก';
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') {
            for (var i = 0; i < allLists.length; i++) {
              if (allLists[i].rowIndex === item.rowIndex) {
                if (newName !== null) allLists[i].name = newName;
                allLists[i].desc = d; allLists[i].image = finalImage; break;
              }
            }
            var finish = function(msg, type) { closeModal(); toast(msg, type || 'success'); renderOrderLists(); };
            if (!item.giftsReady || !gifts.changed()) { finish('บันทึกแล้ว'); return; }
            google.script.run.withSuccessHandler(function(r2) {
              var g2; try { g2 = JSON.parse(r2); } catch (e2) { g2 = {}; }
              if (g2.status !== 'Success') { saveBtn.disabled = false; toast(g2.message || 'บันทึกของแถมไม่สำเร็จ', 'error'); return; }
              item.giftRules = gifts.rules(); item.giftMode = gifts.mode();
              finish('บันทึกแล้ว (ของแถม ' + item.giftRules.length + ' รายการ)');
            }).withFailureHandler(function() { saveBtn.disabled = false; toast('บันทึกของแถมไม่สำเร็จ', 'error'); })
              .adminSaveListGifts(item.rowIndex, gifts.rules(), gifts.mode());
          } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
        } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
      }).adminUpdateOrderListRow(item.rowIndex, d, finalImage, newName);
    });
  }, 'บันทึก');
  el('modal').classList.add('open');
}

function confirmDeleteOrderList(item) {
  el('modalBody').innerHTML = '';
  var wrap = div(''); wrap.style.textAlign = 'center'; wrap.style.padding = '8px 0';
  var icon = document.createElement('div'); icon.style.cssText = 'font-size:2.5rem;margin-bottom:12px;'; icon.innerHTML = '&#x26A0;&#xFE0F;';
  var title2 = document.createElement('div'); title2.style.cssText = 'font-weight:700;font-size:0.95rem;margin-bottom:8px;'; title2.textContent = 'ยืนยันการลบ?';
  var msg = document.createElement('div'); msg.style.cssText = 'font-size:0.85rem;color:var(--text-2);';
  msg.innerHTML = 'ลบ <strong>' + escapeHtml(item.name) + '</strong> ออกจากระบบ';
  var note = document.createElement('div'); note.style.cssText = 'font-size:0.78rem;color:var(--error);margin-top:6px;'; note.textContent = '⚠️ สินค้าและคำสั่งซื้อทั้งหมดในรายการนี้จะถูกลบถาวรด้วย';
  wrap.appendChild(icon); wrap.appendChild(title2); wrap.appendChild(msg); wrap.appendChild(note);
  el('modalBody').appendChild(wrap);

  openModal('&#x1F5D1; ลบรายการสั่งซื้อ', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังลบ...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') { closeModal(); toast('ลบรายการแล้ว', 'success'); loadAllLists(renderOrderLists); }
        else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).adminDeleteOrderList(item.rowIndex);
  }, 'ลบ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

function openSyncSheetModal(item) {
  el('modalBody').innerHTML = '';

  var info = document.createElement('div');
  info.style.cssText = 'font-size:0.85rem;color:var(--text-2);line-height:1.6;margin-bottom:12px;';
  info.innerHTML = '&#x1F504; ดึงข้อมูลสินค้าล่าสุดจากชีต <strong>' + escapeHtml(item.name) + '</strong><br>' +
    '&#x2022; สินค้าที่รหัสตรงกันจะถูก<strong>อัปเดต</strong> (ชื่อ ราคา มัดจำ หยวน รูป ตัวเลือก สถานะ)<br>' +
    '&#x2022; สินค้าใหม่ในชีตจะถูก<strong>เพิ่ม</strong><br>' +
    '&#x2022; สินค้าที่หายไปจากชีต<strong>จะไม่ถูกลบ</strong> ออกจากเว็บ';
  el('modalBody').appendChild(info);

  var stockWrap = document.createElement('label');
  stockWrap.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:10px 12px;background:var(--warning-light);border:1.5px solid var(--warning);border-radius:var(--radius-sm);font-size:0.8rem;color:#7A5000;cursor:pointer;';
  var stockChk = document.createElement('input');
  stockChk.type = 'checkbox'; stockChk.id = 'syncStockChk';
  stockChk.style.cssText = 'margin-top:2px;accent-color:var(--warning);cursor:pointer;';
  var stockTxt = document.createElement('span');
  stockTxt.innerHTML = '<strong>อัปเดตสต็อกคงเหลือจากชีตด้วย</strong><br>ระวัง: จะทับยอดสต็อกที่เว็บตัดไว้จากออเดอร์ที่ลูกค้าสั่งบนเว็บ';
  stockWrap.appendChild(stockChk); stockWrap.appendChild(stockTxt);
  el('modalBody').appendChild(stockWrap);

  openModal('&#x1F504; ซิงก์สินค้าจากชีต', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังซิงก์...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false; saveBtn.textContent = 'ซิงก์';
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          toast('ซิงก์แล้ว: อัปเดต ' + res.updated + ' / เพิ่มใหม่ ' + res.added + ' รายการ', 'success');
          if (currentPanel === 'products' && currentProductsSheetId === item.sheetId) loadProducts(item.sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function(e) {
      saveBtn.disabled = false; saveBtn.textContent = 'ซิงก์';
      toast('เกิดข้อผิดพลาด: ' + (e && e.message || ''), 'error');
    }).adminSyncProductsFromSheet(item.rowIndex, el('syncStockChk').checked);
  }, 'ซิงก์');
  el('modal').classList.add('open');
}

// ════════════════════════════════
// ORDERS
// ════════════════════════════════
function renderOrdersPanel() {
  var visibleLists = getVisibleLists();
  
  // DEFAULT LOGIC: Force "ALL" if nothing is selected
  if (!selectedSheetId || (!visibleLists.find(function(l){ return l.sheetId === selectedSheetId; }) && selectedSheetId !== 'ALL')) {
    selectedSheetId = 'ALL';
    selectedSheetName = 'รวมทุกรายการ';
  }

  setTopbar('คำสั่งซื้อ', selectedSheetName ? 'จาก: ' + selectedSheetName : 'เลือกรายการก่อน');

  // The view + date-range section sits at the top of the page (where the old
  // "ตารางคำสั่งซื้อ / สร้างสรุปยอด" button was); the per-customer summary
  // message is made from each bill in จัดการสถานะ → ถึงไทย / ส่งบิล
  el('topbarActions').innerHTML = '';

  var wrap = document.createElement('div');
  var ctlSlot = document.createElement('div'); wrap.appendChild(ctlSlot);
  renderOrdersControls(ctlSlot);

  var pickerCard = div('section-card');
  pickerCard.appendChild(div('section-card-header', '<div class="section-card-title">&#x1F4CB; เลือกรายการสั่งซื้อ</div>'));
  
  var btnRow = document.createElement('div'); 
  btnRow.className = 'slider-wrap'; 
  
  var btnAll = makeBtn(selectedSheetId === 'ALL' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm', '&#x1F310; ทุกรายการ (รวม)', function() { 
    selectedSheetId = 'ALL'; selectedSheetName = 'รวมทุกรายการ'; 
    setTopbar('คำสั่งซื้อ', 'จาก: ทุกรายการ'); renderOrdersPanel(); 
  });
  btnRow.appendChild(btnAll);

  // Use visibleLists instead of allLists
  for (var i = 0; i < visibleLists.length; i++) {
    var it = visibleLists[i];
    var btn = makeBtn(it.sheetId === selectedSheetId ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm', it.name, (function(item) {
      return function() { selectedSheetId = item.sheetId; selectedSheetName = item.name; setTopbar('คำสั่งซื้อ', 'จาก: ' + item.name); renderOrdersPanel(); };
    })(it));
    btnRow.appendChild(btn);
  }
  pickerCard.appendChild(btnRow); wrap.appendChild(pickerCard);

  var tableHolder = document.createElement('div'); tableHolder.id = 'ordersTable';
  if (!selectedSheetId) tableHolder.appendChild(div('state-empty', '&#x1F4CC; เลือกรายการด้านบนเพื่อดูคำสั่งซื้อ'));
  else tableHolder.appendChild(makeSpinner());
  
  wrap.appendChild(tableHolder); el('content').innerHTML = ''; el('content').appendChild(wrap);
  
  if (selectedSheetId === 'ALL') loadAllOrders();
  else if (selectedSheetId) loadOrders(selectedSheetId);
}

function loadAllOrders() {
  var holder = el('ordersTable'); if (!holder) return;
  holder.innerHTML = ''; holder.appendChild(makeSpinner());
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') {
        holder.innerHTML = '';
        holder.appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message)));
        return;
      }
      if (res.truncated) toast('แสดงคำสั่งซื้อล่าสุด 10,000 รายการ', 'error');
      _ordPayments = res.payments || [];
      renderOrdersTable(res.orders || [], holder, true);
    } catch(e) {
      holder.innerHTML = '';
      holder.appendChild(div('state-empty', 'เกิดข้อผิดพลาด'));
    }
  }).withFailureHandler(function() {
    holder.innerHTML = '';
    holder.appendChild(div('state-empty', 'ไม่สามารถโหลดคำสั่งซื้อได้'));
  }).adminGetAllOrders();
}

function loadOrders(sheetId) {
  var holder = el('ordersTable'); if (!holder) return;
  holder.innerHTML = ''; holder.appendChild(makeSpinner());
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') { holder.innerHTML = ''; holder.appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message))); return; }
      _ordPayments = res.payments || []; renderOrdersTable(res.orders, holder, false);
    } catch(e) { holder.innerHTML = ''; holder.appendChild(div('state-empty', 'เกิดข้อผิดพลาด')); }
  }).adminGetOrders(sheetId);
}

// ── Orders: date range + view (order cards / per-item sales summary) ──
var _ordRange = { preset: 'all', from: '', to: '' };
var _ordView = 'orders'; // 'orders' | 'items'
function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function setOrdPreset(p) {
  var t = new Date(), from = '';
  if (p === 'today') from = ymd(t);
  else if (p === '7d') { var s = new Date(t); s.setDate(t.getDate() - 6); from = ymd(s); }
  else if (p === 'month') from = ymd(new Date(t.getFullYear(), t.getMonth(), 1));
  _ordRange = { preset: p, from: p === 'all' ? '' : from, to: p === 'all' ? '' : ymd(t) };
}
// Compares by the shop's local calendar day, both ends inclusive
function ordersInRange(list) {
  if (!_ordRange.from && !_ordRange.to) return list;
  return list.filter(function(o) {
    var d = new Date(o.timestamp); if (isNaN(d.getTime())) return false;
    var k = ymd(d);
    return (!_ordRange.from || k >= _ordRange.from) && (!_ordRange.to || k <= _ordRange.to);
  });
}
var _ordLast = null; // last render args, so the section can redraw the list without reloading
// (Re)draw the view + range section; any change redraws it and the current orders
function renderOrdersControls(slot) {
  slot.innerHTML = '';
  slot.appendChild(buildOrdersControls(function() {
    renderOrdersControls(slot);
    if (_ordLast && document.body.contains(_ordLast.holder)) renderOrdersTable(_ordLast.orders, _ordLast.holder, _ordLast.isAllView);
  }));
}
function buildOrdersControls(onChange) {
  var box = div('ord-ctl');
  var view = div('ord-seg'); view.setAttribute('role', 'group'); view.setAttribute('aria-label', 'มุมมองคำสั่งซื้อ');
  [['orders', 'คำสั่งซื้อ'], ['items', 'สรุปตามสินค้า']].forEach(function(v) {
    var b = makeBtn('ord-seg-btn' + (_ordView === v[0] ? ' on' : ''), v[1], function() { _ordView = v[0]; onChange(); });
    b.type = 'button'; b.setAttribute('aria-pressed', _ordView === v[0] ? 'true' : 'false');
    view.appendChild(b);
  });
  box.appendChild(view);
  var chips = div('ord-chips');
  [['today', 'วันนี้'], ['7d', '7 วัน'], ['month', 'เดือนนี้'], ['all', 'ทั้งหมด']].forEach(function(p) {
    var b = makeBtn('price-chip' + (_ordRange.preset === p[0] ? ' active' : ''), p[1], function() { setOrdPreset(p[0]); onChange(); });
    b.type = 'button'; chips.appendChild(b);
  });
  box.appendChild(chips);
  var dates = div('ord-dates');
  function dateInp(key, label) {
    var w = document.createElement('label'); w.className = 'ord-date';
    w.appendChild(document.createTextNode(label));
    var i = document.createElement('input'); i.type = 'date'; i.value = _ordRange[key];
    i.onchange = function() { _ordRange[key] = i.value; _ordRange.preset = 'custom'; onChange(); };
    w.appendChild(i); return w;
  }
  dates.appendChild(dateInp('from', 'ตั้งแต่')); dates.appendChild(dateInp('to', 'ถึง'));
  box.appendChild(dates);
  return box;
}

// Per-item sales for the chosen range, one card per product:
//   1  Photocard LADS                         6 ชิ้น
//      ราคาหยวน ¥20      รวมราคาหยวน ¥120
//      ราคา Full ฿150    Total Full ฿900
//      · ราฟาเอล ซองจดหมาย   5 ชิ้น · ¥100 · ฿750
// "Product (Variant)" orders are grouped under their product; most pieces first.
// The copy button writes tab-separated rows that paste into Sheets/Excel as columns.
function buildItemSummary(orders) {
  function lineYuan(o) { return Number(o.totalYuan) || (Number(o.yuan) || 0) * (Number(o.qty) || 0); }
  function lineFull(o) { return Number(o.totalFull) || (Number(o.fullPrice) || 0) * (Number(o.qty) || 0); }
  function bucket(name) { return { name: name, qty: 0, yuan: 0, full: 0, dep: 0, yu: {}, fu: {} }; }
  function add(b, o) {
    var q = Number(o.qty) || 0;
    b.qty += q; b.yuan += lineYuan(o); b.full += lineFull(o);
    if (o.payType === 'Deposit') b.dep += q;
    b.yu[Number(o.yuan) || 0] = true; b.fu[Number(o.fullPrice) || 0] = true;
  }
  // Unit price; a range when it changed during the period
  function unit(set, sym) {
    var v = Object.keys(set).map(Number).sort(function(a, b) { return a - b; });
    var f = function(n) { return sym + n.toLocaleString('th-TH', { maximumFractionDigits: 2 }); };
    return v.length > 1 ? f(v[0]) + '–' + f(v[v.length - 1]) : f(v[0] || 0);
  }
  var yen = function(n) { return '¥' + (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 }); };

  var groups = {}, list = [];
  orders.forEach(function(o) {
    var label = String(o.product || '').trim(), base = label, variant = '';
    var m = label.match(/^(.*) \(([^()]*)\)$/);
    if (m) { base = m[1].trim(); variant = m[2].split(':')[0].trim(); }
    var g = groups[base];
    if (!g) { g = groups[base] = bucket(base); g.variants = {}; list.push(g); }
    add(g, o);
    if (variant) add(g.variants[variant] || (g.variants[variant] = bucket(variant)), o);
  });
  list.sort(function(a, b) { return b.qty - a.qty || b.full - a.full; });

  var wrap = div('isum'); wrap.id = 'ordersDataTable';
  var grid = div('isum-grid'); wrap.appendChild(grid);
  var sumQty = 0, sumYuan = 0, sumFull = 0;
  list.forEach(function(g, i) {
    sumQty += g.qty; sumYuan += g.yuan; sumFull += g.full;
    var vs = Object.keys(g.variants).map(function(k) { return g.variants[k]; }).sort(function(a, b) { return b.qty - a.qty; });
    var row = div('isum-row');
    row.setAttribute('data-search', (g.name + ' ' + vs.map(function(v) { return v.name; }).join(' ')).toLowerCase());
    var top = div('isum-top');
    top.appendChild(div('isum-rank', String(i + 1)));
    var nm = div('isum-name'); nm.textContent = g.name; nm.title = g.name; top.appendChild(nm);
    top.appendChild(div('isum-qty', '<strong>' + g.qty + '</strong> ชิ้น'));
    row.appendChild(top);
    var nums = div('isum-nums');
    [['ราคาหยวน', unit(g.yu, '¥')], ['รวมราคาหยวน', yen(g.yuan)], ['ราคา Full', unit(g.fu, '฿')], ['Total Full', baht(g.full)]].forEach(function(n, j) {
      var c = div('isum-num' + (j % 2 ? ' total' : ''));
      c.appendChild(div('isum-num-l', n[0])); var v = div('isum-num-v'); v.textContent = n[1]; c.appendChild(v);
      nums.appendChild(c);
    });
    row.appendChild(nums);
    if (g.dep) row.appendChild(div('isum-sub', '<span class="badge badge-deposit">มัดจำ ' + g.dep + ' ชิ้น</span>'));
    if (vs.length) {
      var vl = div('isum-vars');
      vs.forEach(function(v) {
        var vr = div('isum-var');
        var vn = document.createElement('span'); vn.textContent = v.name; vr.appendChild(vn);
        vr.appendChild(div('isum-var-n', v.qty + ' ชิ้น · ' + escapeHtml(yen(v.yuan)) + ' · ' + escapeHtml(baht(v.full))));
        vl.appendChild(vr);
      });
      row.appendChild(vl);
    }
    grid.appendChild(row);
  });

  var foot = div('isum-foot');
  foot.appendChild(div('isum-foot-t', list.length + ' สินค้า · <strong>' + sumQty + '</strong> ชิ้น · <strong>' + escapeHtml(yen(sumYuan)) + '</strong> · <strong>' + escapeHtml(baht(sumFull)) + '</strong>'));
  foot.appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; คัดลอกเป็นตาราง', function() {
    // One row per variant (or per product without variants), plus a total row
    var plain = function(n) { return String(Math.round((Number(n) || 0) * 100) / 100); };
    var unitPlain = function(set) { var v = Object.keys(set).map(Number).sort(function(a, b) { return a - b; }); return v.length > 1 ? v[0] + '-' + v[v.length - 1] : plain(v[0]); };
    var cell = function(t) { return String(t).replace(/[\t\n\r]+/g, ' '); };
    var rows = [['สินค้า', 'จำนวน', 'ราคาหยวน', 'รวมราคาหยวน', 'ราคา Full (THB)', 'Total Full']];
    list.forEach(function(g) {
      var vs = Object.keys(g.variants);
      if (!vs.length) rows.push([g.name, g.qty, unitPlain(g.yu), plain(g.yuan), unitPlain(g.fu), plain(g.full)]);
      else vs.forEach(function(k) {
        var v = g.variants[k];
        rows.push([g.name + ' (' + k + ')', v.qty, unitPlain(v.yu), plain(v.yuan), unitPlain(v.fu), plain(v.full)]);
      });
    });
    rows.push(['รวม', sumQty, '', plain(sumYuan), '', plain(sumFull)]);
    var text = rows.map(function(r) { return r.map(cell).join('\t'); }).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function() { toast('คัดลอกแล้ว — วางใน Google Sheets / Excel ได้เลย', 'success'); }, function() { toast('คัดลอกไม่สำเร็จ', 'error'); });
  }));
  wrap.appendChild(foot);
  return wrap;
}

function renderOrdersTable(orders, holder, isAllView) {
  holder.innerHTML = '';
  if (!orders || !orders.length) { holder.appendChild(div('state-empty', '&#x1F4ED; ยังไม่มีคำสั่งซื้อค่ะ')); return; }

  // Sort by timestamp descending so newest are at the top
  orders.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  // Range + view controls; everything below (stats, cards, summary) uses the range
  var allOrders = orders;
  _ordLast = { orders: allOrders, holder: holder, isAllView: isAllView };
  orders = ordersInRange(allOrders);
  if (!orders.length) { holder.appendChild(div('state-empty', 'ไม่มีคำสั่งซื้อในช่วงวันที่นี้')); return; }

  var totalRev = 0, uCust = {}, totalItems = 0;
  for (var i = 0; i < orders.length; i++) {
    totalRev += Number(orders[i].total) || 0;
    uCust[orders[i].customer] = true;
    if (orders[i].payType !== 'Gift') totalItems += Number(orders[i].qty) || 0; // gifts aren't sold pieces
  }

  var statRow = div('stat-row');
  statRow.appendChild(makeStat('คำสั่งซื้อ', orders.length, 'primary'));
  statRow.appendChild(makeStat('ลูกค้า', Object.keys(uCust).length, ''));
  statRow.appendChild(makeStat('ชิ้น', totalItems, ''));
  statRow.appendChild(makeStat('ยอดรวม', fmt(totalRev), 'success'));
  holder.appendChild(statRow);

  var card = div('section-card');
  var hdr = div('section-card-header');
  hdr.appendChild(div('section-card-title', _ordView === 'items' ? '&#x1F4CA; สรุปยอดขายตามสินค้า' : '&#x1F9FE; รายการคำสั่งซื้อ'));

  var rightWrap = document.createElement('div');
  rightWrap.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;';

  var openShopBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F517; เปิดชีต', function() {
    var targetUrl = '';

    if (isAllView) {
      if (!selectedSheetId || selectedSheetId === 'ALL') {
        toast('กรุณาเลือกร้านค้าก่อน', 'error');
        return;
      }
      for (var i = 0; i < allLists.length; i++) {
        if (allLists[i].sheetId === selectedSheetId) {
          targetUrl = allLists[i].url || '';
          break;
        }
      }
    } else {
      for (var j = 0; j < allLists.length; j++) {
        if (allLists[j].sheetId === selectedSheetId) {
          targetUrl = allLists[j].url || '';
          break;
        }
      }
    }

    if (!targetUrl) {
      toast('ไม่พบลิงก์ร้านค้า', 'error');
      return;
    }

    window.open(toMainSheetUrl(targetUrl), '_blank');
  });

  var searchWrap = div('search-row');
  searchWrap.innerHTML = SVG_SEARCH;
  var searchInp = document.createElement('input');
  searchInp.placeholder = 'ค้นหาลูกค้า / เบอร์ / สินค้า';
  searchInp.oninput = function() { filterOrderRows(this.value); };
  searchWrap.appendChild(searchInp);

  // Multi-select delete — only in single-list view (rowIndex maps to that list's orders)
  var delSelBtn = null;
  if (!isAllView) {
    delSelBtn = makeBtn('btn btn-danger btn-sm', '&#x1F5D1; ลบที่เลือก', function() { confirmDeleteSelectedOrders(); });
    delSelBtn.id = 'orderDelSelBtn';
  }
  rightWrap.appendChild(openShopBtn);
  rightWrap.appendChild(searchWrap);

  hdr.appendChild(rightWrap);
  card.appendChild(hdr);

  if (_ordView === 'items') { card.appendChild(buildItemSummary(orders)); holder.appendChild(card); return; }

  // ── One card per checkout (Shopee-cart style) ──
  //   ☐ @customer · 08x…                 9 ส.ค. 17:28
  //   ☐ สุ่มโปสการ์ด …                 ×2      ฿240
  //   ☐ การ์ดฟิล์ม … [มัดจำ]            ×1      ฿30
  //   2 รายการ · 3 ชิ้น   ค้างชำระ ฿90    รวม ฿270
  function formatDate(dStr) {
    if (!dStr) return '—';
    var d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr;
    return d.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function statusKey(o) { return o.shippedAt ? 'S|' + o.shippedAt + '|' + o.tracking : 'T|' + (o.status || ''); }
  function statusText(o) {
    if (o.shippedAt) return '📦 ส่งแล้ว ' + formatDate(o.shippedAt) + (o.tracking ? ' · ' + o.tracking : '');
    return o.status === 'ยกเลิก' ? '✕ ยกเลิก' : o.status ? '• ' + o.status : '';
  }
  function statusClass(o) { return o.shippedAt ? '' : o.status === 'ยกเลิก' ? ' cancel' : o.status ? ' custom' : ''; }
  // Items of one checkout share checkout_id; older rows fall back to same list + customer + minute
  var groups = [], byKey = {};
  orders.forEach(function(o) {
    var key = o.checkoutId ? 'c:' + o.checkoutId : 't:' + (o.shopName || '') + '|' + o.customer + '|' + String(o.timestamp || '').slice(0, 16);
    if (!byKey[key]) { byKey[key] = { first: o, items: [] }; groups.push(byKey[key]); }
    byKey[key].items.push(o);
  });

  // Move items into another customer's checkout of the same list
  function canMove(items, tg) {
    var o0 = tg.items[0];
    if (o0.remark === 'POS' || items.some(function(o) { return o.remark === 'POS'; })) { toast('ย้ายรายการหน้าร้าน (POS) ไม่ได้', 'error'); return false; }
    if (items.some(function(o) { return o.listId !== o0.listId; })) { toast('ย้ายได้เฉพาะภายในรายการสั่งซื้อเดียวกัน', 'error'); return false; }
    return true;
  }
  function moveItems(items, tg) {
    if (!canMove(items, tg)) return;
    var to = tg.items[0];
    askConfirm('ย้าย ' + items.length + ' รายการไปเป็นของ ' + to.customer + '?\n(สลิปที่ส่งมาแล้วยังอยู่กับลูกค้าเดิม)', 'ย้าย').then(function(ok) {
      if (ok) moveNow(items, to);
    });
  }
  function moveNow(items, to) {
    apiCall('adminMoveOrderItems', items.map(function(o) { return o.id; }), to.id).then(function(res) {
      if (res.status !== 'Success') { toast(res.message || 'ย้ายไม่สำเร็จ', 'error'); return; }
      items.forEach(function(o) {
        o.customer = res.customer; o.remark = res.remark; o.checkoutId = res.checkoutId; o.timestamp = res.timestamp; o.deliveryId = '';
      });
      toast('ย้ายแล้ว ' + res.moved + ' รายการ', 'success');
      renderOrdersTable(_ordLast.orders, _ordLast.holder, _ordLast.isAllView);
    });
  }
  // Tap version: pick items and the order to move them to
  function openMoveModal(g) {
    var targets = groups.filter(function(x) {
      return x !== g && x.first.listId === g.first.listId && x.first.remark !== 'POS';
    });
    if (!targets.length) { toast('ไม่มีออเดอร์อื่นในรายการนี้', 'error'); return; }
    el('modalBody').innerHTML = '';
    var pf = div('modal-field'); var pl = document.createElement('label'); pl.textContent = 'สินค้าที่จะย้าย'; pf.appendChild(pl);
    var boxes = g.items.map(function(o) {
      var row = document.createElement('label'); row.className = 'ship-pick';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; row.appendChild(cb);
      var t = document.createElement('span'); t.textContent = o.product + ' ×' + o.qty; row.appendChild(t);
      pf.appendChild(row); return cb;
    });
    el('modalBody').appendChild(pf);
    var tf = div('modal-field'); var tl = document.createElement('label'); tl.htmlFor = 'moveTarget'; tl.textContent = 'ย้ายไปออเดอร์ของ'; tf.appendChild(tl);
    var sel = document.createElement('select'); sel.id = 'moveTarget';
    targets.forEach(function(x, i) {
      var e = document.createElement('option'); e.value = i;
      e.textContent = x.first.customer + ' · ' + new Date(x.first.timestamp).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) + ' · ' + x.items.length + ' รายการ';
      sel.appendChild(e);
    });
    tf.appendChild(sel); el('modalBody').appendChild(tf);
    openModal('&#x21C4; ย้ายสินค้า · ' + escapeHtml(g.first.customer), '', function() {
      var chosen = g.items.filter(function(o, i) { return boxes[i].checked; });
      if (!chosen.length) { toast('กรุณาเลือกอย่างน้อย 1 รายการ', 'error'); return; }
      closeModal(); moveItems(chosen, targets[Number(sel.value)]);
    }, 'ย้าย');
  }

  var list = div('olist'); list.id = 'ordersDataTable';
  groups.forEach(function(g) {
    var o0 = g.first, sum = 0, pcs = 0, owed = 0, search = [o0.customer, o0.remark, o0.shopName || ''];
    var gc = div('ocard');

    var head = div('ocard-head');
    if (!isAllView) {
      var gSel = document.createElement('input'); gSel.type = 'checkbox'; gSel.className = 'ocard-sel';
      gSel.setAttribute('aria-label', 'เลือกคำสั่งซื้อทั้งหมดของ ' + o0.customer);
      head.appendChild(gSel);
    }
    var who = div('ocard-who');
    var nm = document.createElement('span'); nm.className = 'ocard-name'; nm.textContent = o0.customer || '—'; who.appendChild(nm);
    var sub = div('ocard-sub');
    if (isAllView && o0.shopName) { var shop = document.createElement('span'); shop.className = 'ocard-shop'; shop.textContent = o0.shopName; sub.appendChild(shop); }
    if (o0.remark) {
      var tel = String(o0.remark).replace(/[^\d+]/g, '');
      var ph = document.createElement(tel.length >= 9 ? 'a' : 'span'); ph.className = 'ocard-phone'; ph.textContent = o0.remark;
      if (tel.length >= 9) ph.href = 'tel:' + tel;
      sub.appendChild(ph);
    }
    if (sub.childNodes.length) who.appendChild(sub);
    head.appendChild(who);
    var time = div('ocard-time'); time.textContent = formatDate(o0.timestamp); head.appendChild(time);
    gc.appendChild(head);

    // Each item has one status (shipped + tracking, cancelled, a custom
    // label, or waiting). When all items share one, the card shows it once.
    var stKeys = {};
    g.items.forEach(function(o) { stKeys[statusKey(o)] = true; if (o.tracking) search.push(o.tracking); if (o.status) search.push(o.status); });
    var oneStatus = Object.keys(stKeys).length === 1;

    var items = div('ocard-items');
    g.items.forEach(function(o) {
      var isDep = o.payType === 'Deposit';
      sum += Number(o.total) || 0; if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
      if (isDep && Number(o.totalFull) > Number(o.total)) owed += Number(o.totalFull) - Number(o.total);
      search.push(o.product);
      var it = div('oitem');
      if (!isAllView) {
        var sel = document.createElement('input'); sel.type = 'checkbox'; sel.className = 'order-sel';
        sel.setAttribute('data-row', o.rowIndex); sel.setAttribute('aria-label', 'เลือก ' + o.product);
        it.appendChild(sel);
      }
      var info = div('oitem-info');
      var pn = div('oitem-name'); pn.textContent = o.product; info.appendChild(pn);
      // Every item says how it was paid: deposit (with its full price) or full
      info.appendChild(isDep
        ? div('oitem-sub', '<span class="badge badge-deposit">มัดจำ</span> ราคาเต็ม ' + escapeHtml(baht(o.totalFull || o.fullPrice * o.qty)))
        : o.payType === 'Gift'
          ? div('oitem-sub', '<span class="badge badge-gift">ของแถม</span>')
          : div('oitem-sub', '<span class="badge badge-full">จ่ายเต็ม</span>'));
      if (!oneStatus && statusText(o)) {
        var os = div('oitem-ship' + statusClass(o)); os.textContent = statusText(o);
        info.appendChild(os);
      }
      it.appendChild(info);
      var qty = div('oitem-qty'); qty.textContent = '×' + o.qty; it.appendChild(qty);
      var pr = div('oitem-price'); pr.textContent = baht(o.total); it.appendChild(pr);
      if (o.remark !== 'POS') dragSource(it, function() { return { move: [o], from: g }; });
      items.appendChild(it);
    });
    gc.appendChild(items);
    if (o0.remark !== 'POS') {
      dragSource(gc, function() { return { move: g.items, from: g }; });
      dropZone(gc, function(d) { if (d.move && d.from !== g) moveItems(d.move, g); });
    }

    var foot = div('ocard-foot');
    var cnt = div('ocard-count'); cnt.textContent = g.items.length + ' รายการ · ' + pcs + ' ชิ้น'; foot.appendChild(cnt);
    if (owed > 0) { var ow = div('ocard-owed'); ow.textContent = 'ค้างชำระ ' + baht(owed); foot.appendChild(ow); }
    var tot = div('ocard-total'); tot.innerHTML = 'รวม <strong>' + escapeHtml(baht(sum)) + '</strong>'; foot.appendChild(tot);
    gc.appendChild(foot);

    var shippedN = g.items.filter(function(o) { return o.shippedAt; }).length;
    var waiting = g.items.filter(isWaiting).length;
    var allCancelled = oneStatus && !g.items[0].shippedAt && g.items[0].status === 'ยกเลิก';
    var ship = div('ocard-ship' + (allCancelled ? ' cancel' : !waiting ? ' done' : waiting < g.items.length ? ' part' : ''));
    var stText = oneStatus ? statusText(g.items[0]) : shippedN ? '📦 ส่งแล้ว ' + shippedN + '/' + g.items.length + ' รายการ' : 'หลายสถานะ';
    if (stText) { var st = div('ocard-ship-info'); st.textContent = stText; ship.appendChild(st); }
    // Slips this customer sent for this list
    var pays = _ordPayments.filter(function(p) { return p.listId === o0.listId && normCust(p.customer) === normCust(o0.customer); });
    if (pays.length) {
      ship.appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F9FE; สลิป (' + pays.length + ')',
        (function(ps, who) { return function() { openPaymentsModal(ps, who); }; })(pays, o0.customer)));
    }
    if (o0.remark !== 'POS') {
      var mvBtn = makeBtn('btn btn-ghost btn-sm touch-only', '&#x21C4; ย้าย', (function(gr) { return function() { openMoveModal(gr); }; })(g));
      mvBtn.title = 'ย้ายสินค้าไปออเดอร์ของลูกค้าคนอื่น (หรือลากสินค้าไปวางบนการ์ดอื่น)';
      ship.appendChild(mvBtn);
    }
    ship.appendChild(makeBtn('btn btn-sm ' + (waiting ? 'btn-primary' : 'btn-ghost'), waiting ? '&#x1F4E6; อัปเดตสถานะ' : 'แก้ไข',
      (function(items) { return function() { openStatusModal(items); }; })(g.items)));
    gc.appendChild(ship);

    gc.setAttribute('data-search', search.join(' ').toLowerCase());
    list.appendChild(gc);
  });
  card.appendChild(list);

  // Bottom bar (single list only — delete addresses that list's rows): select all + delete
  if (!isAllView) {
    var bar = div('sticky-save-bar obar');
    var allLbl = document.createElement('label'); allLbl.className = 'obar-all';
    var allChk = document.createElement('input'); allChk.type = 'checkbox'; allChk.id = 'orderSelAll';
    allLbl.appendChild(allChk); allLbl.appendChild(document.createTextNode(' ทั้งหมด'));
    bar.appendChild(allLbl);
    var selInfo = document.createElement('span'); selInfo.className = 'save-count'; selInfo.id = 'orderSelCount'; selInfo.textContent = 'ยังไม่ได้เลือก';
    bar.appendChild(selInfo);
    delSelBtn.style.display = '';
    delSelBtn.disabled = true;
    bar.appendChild(delSelBtn);
    card.appendChild(bar);
  }
  holder.appendChild(card);

  if (!isAllView) {
    var refreshDelBtn = function() {
      var n = list.querySelectorAll('.order-sel:checked').length;
      delSelBtn.disabled = !n;
      delSelBtn.innerHTML = '&#x1F5D1; ลบที่เลือก' + (n ? ' (' + n + ')' : '');
      el('orderSelCount').textContent = n ? 'เลือก ' + n + ' รายการ' : 'ยังไม่ได้เลือก';
      el('orderSelCount').className = 'save-count' + (n ? ' has-changes' : '');
      // A card's box mirrors its items: all → checked, some → dash
      list.querySelectorAll('.ocard').forEach(function(c) {
        var all = c.querySelectorAll('.order-sel'), on = c.querySelectorAll('.order-sel:checked').length;
        var gs = c.querySelector('.ocard-sel'); gs.checked = on === all.length; gs.indeterminate = on > 0 && on < all.length;
      });
    };
    card.addEventListener('change', function(e) {
      if (e.target.id === 'orderSelAll') {
        // Select-all only applies to cards visible under the current search filter
        list.querySelectorAll('.ocard').forEach(function(c) {
          if (c.style.display === 'none') return;
          c.querySelectorAll('.order-sel').forEach(function(cb) { cb.checked = e.target.checked; });
        });
      } else if (e.target.classList.contains('ocard-sel')) {
        e.target.closest('.ocard').querySelectorAll('.order-sel').forEach(function(cb) { cb.checked = e.target.checked; });
      } else if (!e.target.classList.contains('order-sel')) return;
      refreshDelBtn();
    });
  }
}

var _ordPayments = []; // slips for the loaded orders (no photos), set by loadOrders / loadAllOrders
function normCust(n) { return String(n || '').trim().toLowerCase().replace(/^@+/, ''); }
// Still to do: not shipped and not cancelled (custom labels count as waiting)
function isWaiting(o) { return !o.shippedAt && o.status !== 'ยกเลิก'; }
var SLIP_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/]+=*$/;

// Set the status of some or all items of one checkout. Choices are
// shipped / waiting / cancelled, plus custom labels already in use and
// "+ new". Ticks the items still waiting; when none, ticks all.
// opts (status manager): noPick — apply to all items without a checklist;
// api — server call (old-sheet rows use adminSetLegacyStatus); labels —
// custom labels to offer; after — redraw instead of the order cards.
function openStatusModal(items, opts) {
  opts = opts || {};
  var pending = items.filter(isWaiting);
  var picked = pending.length ? pending : items;
  el('modalBody').innerHTML = '';

  var boxes = [];
  if (opts.noPick) {
    el('modalBody').appendChild(div('modal-field', '<label>เปลี่ยนสถานะ ' + items.length + ' รายการ</label>'));
  } else if (items.length > 1) {
    var pickField = div('modal-field');
    var pl = document.createElement('label'); pl.textContent = 'รายการที่จะอัปเดต'; pickField.appendChild(pl);
    items.forEach(function(o) {
      var row = document.createElement('label'); row.className = 'ship-pick';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = picked.indexOf(o) !== -1;
      boxes.push(cb); row.appendChild(cb);
      var t = document.createElement('span'); t.textContent = o.product + ' ×' + o.qty; row.appendChild(t);
      var cur = o.shippedAt ? '📦 ' + (o.tracking || 'ส่งแล้ว') : o.status;
      if (cur) { var st = document.createElement('small'); st.textContent = cur; row.appendChild(st); }
      pickField.appendChild(row);
    });
    el('modalBody').appendChild(pickField);
  }

  var custom = {};
  (opts.labels || ((_ordLast && _ordLast.orders) || []).map(function(o) { return o.status; }))
    .forEach(function(l) { if (l && l !== 'ยกเลิก' && l !== 'จัดส่งแล้ว' && l !== ARRIVED_LABEL) custom[l] = true; });
  var sf = div('modal-field');
  var sl = document.createElement('label'); sl.htmlFor = 'stSelect'; sl.textContent = 'สถานะ'; sf.appendChild(sl);
  var sel = document.createElement('select'); sel.id = 'stSelect';
  [['shipped', '📦 จัดส่งแล้ว'], ['', 'ยังไม่ส่ง'], [ARRIVED_LABEL, '🇹🇭 ' + ARRIVED_LABEL], ['ยกเลิก', '✕ ยกเลิก']]
    .concat(Object.keys(custom).sort().map(function(c) { return [c, c]; }))
    .concat([['__new', '+ เพิ่มสถานะใหม่…']])
    .forEach(function(op) { var e = document.createElement('option'); e.value = op[0]; e.textContent = op[1]; sel.appendChild(e); });
  // Items still waiting → suggest "shipped"; otherwise show what they share
  var p0 = picked[0];
  var same = picked.every(function(o) { return !!o.shippedAt === !!p0.shippedAt && o.status === p0.status; });
  sel.value = pending.length && !p0.status ? 'shipped' : same ? (p0.shippedAt ? 'shipped' : p0.status) : 'shipped';
  if (opts.preset !== undefined) sel.value = opts.preset; // e.g. the 📦 ship buttons
  sf.appendChild(sel);
  var newInp = document.createElement('input'); newInp.placeholder = 'เช่น ถึงไทย'; newInp.maxLength = 40;
  newInp.style.marginTop = '8px'; newInp.setAttribute('aria-label', 'ชื่อสถานะใหม่');
  sf.appendChild(newInp);
  el('modalBody').appendChild(sf);

  var tf = div('modal-field');
  var lbl = document.createElement('label'); lbl.htmlFor = 'shipTracking'; lbl.textContent = 'เลขพัสดุ (ไม่บังคับ)';
  var inp = document.createElement('input'); inp.id = 'shipTracking';
  inp.placeholder = 'เช่น TH1234567890'; inp.autocomplete = 'off';
  // Prefill only when every ticked item already shares one tracking number
  var trk = picked.map(function(o) { return o.tracking || ''; });
  inp.value = trk.every(function(t) { return t === trk[0]; }) ? trk[0] : '';
  inp.onkeydown = function(e) { if (e.key === 'Enter') save(); };
  tf.appendChild(lbl); tf.appendChild(inp);
  // Courier → the customer gets the right tracking link
  var cs = document.createElement('select'); cs.id = 'shipCourier'; cs.setAttribute('aria-label', 'ขนส่ง');
  cs.style.marginTop = '8px';
  [['', 'ขนส่ง (ไม่ระบุ — เดาจากเลขพัสดุ)']].concat(Couriers.list.map(function(c) { return [c.code, c.name]; }))
    .forEach(function(op) { var e = document.createElement('option'); e.value = op[0]; e.textContent = op[1]; cs.appendChild(e); });
  var cur = picked.map(function(o) { return o.courier || ''; });
  if (cur[0] && cur.every(function(c) { return c === cur[0]; })) {
    if (![].some.call(cs.options, function(o) { return o.value === cur[0]; })) {
      var extra = document.createElement('option'); extra.value = cur[0]; extra.textContent = Couriers.name(cur[0]); cs.appendChild(extra);
    }
    cs.value = cur[0];
  }
  if (opts.api === 'adminSetLegacyStatus') cs.hidden = true; // old sheet rows have no courier
  tf.appendChild(cs);
  el('modalBody').appendChild(tf);

  function sync() { tf.hidden = sel.value !== 'shipped'; newInp.hidden = sel.value !== '__new'; }
  sel.onchange = function() { sync(); (sel.value === '__new' ? newInp : inp).focus(); };
  sync();

  function save() {
    var chosen = boxes.length ? items.filter(function(o, i) { return boxes[i].checked; }) : items;
    if (!chosen.length) { toast('กรุณาเลือกอย่างน้อย 1 รายการ', 'error'); return; }
    var status = sel.value === '__new' ? newInp.value.trim() : sel.value;
    if (sel.value === '__new' && (!status || status === 'shipped')) { toast('กรุณาพิมพ์ชื่อสถานะ', 'error'); newInp.focus(); return; }
    var saveBtn = el('modalSave'); saveBtn.disabled = true;
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      var res; try { res = JSON.parse(r); } catch (e) { toast('เกิดข้อผิดพลาด', 'error'); return; }
      if (res.status !== 'Success') { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return; }
      // Update the loaded orders in place and redraw — no reload needed
      chosen.forEach(function(o) { o.shippedAt = res.shippedAt || ''; o.tracking = res.tracking || ''; o.status = res.orderStatus || ''; o.courier = res.courier || ''; });
      closeModal();
      toast('อัปเดตสถานะแล้ว ' + chosen.length + ' รายการ', 'success');
      if (opts.after) opts.after();
      else if (_ordLast && document.body.contains(_ordLast.holder)) renderOrdersTable(_ordLast.orders, _ordLast.holder, _ordLast.isAllView);
    }).withFailureHandler(function() {
      saveBtn.disabled = false; toast('บันทึกไม่สำเร็จ', 'error');
    })[opts.api || 'adminSetOrderStatus'](chosen.map(function(o) { return o.id; }).filter(Boolean), status, inp.value, cs.value);
  }

  openModal('&#x1F4E6; ' + (opts.noPick ? 'เปลี่ยนสถานะ' : escapeHtml(items[0].customer || 'สถานะ')), '', save, 'บันทึก');
  el('modal').classList.add('open');
}

// Slips + delivery address a customer sent for one list. Photos load on
// demand and are gone once everything in the list is shipped.
function openPaymentsModal(pays, who) {
  function when(d) { return d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
  el('modalBody').innerHTML = '';
  pays.forEach(function(p) {
    var box = div('pay-card');
    var top = div('pay-top');
    var amt = document.createElement('strong'); amt.textContent = baht(p.amount); top.appendChild(amt);
    if (PAY_KIND[p.kind]) top.appendChild(payKindTag(p.kind));
    var at = document.createElement('span'); at.textContent = 'โอน ' + when(p.paidAt); top.appendChild(at);
    box.appendChild(top);
    if (p.bankRef) { var ref = div('pay-line'); ref.textContent = 'เลขอ้างอิง ' + p.bankRef; box.appendChild(ref); }
    // Order slips don't carry an address any more; only flag a missing one on bill slips
    if (p.address || p.deliveryId) {
      var addr = div('pay-addr' + (p.address ? '' : ' muted'));
      addr.textContent = p.address || 'ไม่ได้แนบที่อยู่';
      box.appendChild(addr);
    }
    if (p.address) {
      box.appendChild(makeBtn('btn btn-ghost btn-sm', 'คัดลอกที่อยู่', function() {
        (navigator.clipboard ? navigator.clipboard.writeText(p.address) : Promise.reject())
          .then(function() { toast('คัดลอกแล้ว', 'success'); }, function() { toast('คัดลอกไม่สำเร็จ', 'error'); });
      }));
    }
    var sent = div('pay-line muted'); sent.textContent = 'ส่งเมื่อ ' + when(p.createdAt); box.appendChild(sent);
    var slip = div('pay-slip');
    if (p.hasSlip) {
      slip.textContent = 'กำลังโหลดสลิป...';
      google.script.run.withSuccessHandler(function(r) {
        var res; try { res = JSON.parse(r); } catch (e) { res = {}; }
        if (res.status !== 'Success' || !SLIP_RE.test(res.slip || '')) { slip.textContent = 'โหลดสลิปไม่ได้'; return; }
        slip.textContent = '';
        var img = document.createElement('img'); img.src = res.slip; img.alt = 'สลิปของ ' + who;
        img.title = 'แตะเพื่อขยาย'; img.onclick = function() { slip.classList.toggle('zoom'); };
        slip.appendChild(img);
      }).withFailureHandler(function() { slip.textContent = 'โหลดสลิปไม่ได้'; }).adminGetPaymentSlip(p.id);
    } else {
      slip.className += ' muted'; slip.textContent = 'ลบรูปสลิปแล้ว (จัดส่งครบ)';
    }
    box.appendChild(slip);
    el('modalBody').appendChild(box);
  });
  openModal('&#x1F9FE; ' + escapeHtml(who), '', null);
  el('modal').classList.add('open');
}

// What a slip paid for (set when the customer sends it)
var PAY_KIND = { deposit: 'มัดจำ', full: 'จ่ายเต็ม', balance: 'ส่วนที่เหลือ + ค่าส่ง' };
function payKindTag(kind) {
  var t = document.createElement('span'); t.className = 'pay-kind ' + kind; t.textContent = PAY_KIND[kind];
  return t;
}

// ════════════════════════════════
// SLIPS / ADDRESSES — every slip customers sent, across all lists
// ════════════════════════════════
// cat: 'order' = slips for goods (step 1, รอชำระเงิน) · 'bill' = slips for delivery bills (step 3)
var _slipView = { cat: 'order', list: '', filter: 'all', q: '' };
function slipCat(p) { return p.deliveryId ? 'bill' : 'order'; }
function renderSlipsPanel() {
  setTopbar('สลิป / ที่อยู่', 'หลักฐานการโอนและที่อยู่จากลูกค้า');
  el('topbarActions').innerHTML = '';
  el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x21BB; รีเฟรช', renderSlipsPanel));
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  google.script.run.withSuccessHandler(function(r) {
    var res; try { res = JSON.parse(r); } catch (e) { res = { message: 'เกิดข้อผิดพลาด' }; }
    el('content').innerHTML = '';
    if (res.status !== 'Success') { el('content').appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message || 'โหลดไม่สำเร็จ'))); return; }
    drawSlips(res.payments || []);
  }).withFailureHandler(function() {
    el('content').innerHTML = ''; el('content').appendChild(div('state-empty', 'โหลดสลิปไม่สำเร็จ'));
  }).adminGetPayments();
}

function drawSlips(pays) {
  var names = {};
  allLists.forEach(function(l) { names[l.sheetId] = l.name; });
  var wrap = document.createElement('div');

  // Controls: category tabs, list, filter chips, search
  var ctl = div('section-card slip-ctl');
  var n = { order: 0, bill: 0 }; pays.forEach(function(p) { n[slipCat(p)]++; });
  var tabs = div('stg-tabs slip-cats'); tabs.setAttribute('role', 'tablist');
  // The step-3 bill holds what's left of the price plus the delivery fee, and is where the address comes in
  [['order', '🛒 ตอนสั่งซื้อ', 'สลิปตอนสั่งซื้อ (มัดจำ / จ่ายเต็ม)'],
   ['bill', '🧾 ส่วนที่เหลือ + ค่าส่ง', 'สลิปที่ลูกค้าโอนตามบิล (ส่วนที่เหลือ + ค่าส่ง) พร้อมที่อยู่']].forEach(function(c) {
    var t = makeBtn('stg-tab' + (_slipView.cat === c[0] ? ' on' : ''), escapeHtml(c[1]) + '<span class="stg-count">' + n[c[0]] + '</span>', function() {
      _slipView.cat = c[0];
      tabs.querySelectorAll('.stg-tab').forEach(function(x) { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t); });
      syncChips(); closeMove(); draw();
    });
    t.type = 'button'; t.title = c[2]; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', _slipView.cat === c[0]);
    tabs.appendChild(t);
  });
  ctl.appendChild(tabs);
  var sel = document.createElement('select'); sel.className = 'slip-list'; sel.setAttribute('aria-label', 'รายการสั่งซื้อ');
  var used = {}; pays.forEach(function(p) { used[p.listId] = true; });
  [['', 'ทุกรายการ']].concat(Object.keys(used).map(function(id) { return [id, names[id] || '(รายการที่ลบแล้ว)']; }))
    .forEach(function(o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; sel.appendChild(e); });
  sel.value = used[_slipView.list] ? _slipView.list : '';
  sel.onchange = function() { _slipView.list = sel.value; draw(); };
  ctl.appendChild(sel);
  var chips = div('ord-chips');
  [['all', 'ทั้งหมด'], ['addr', 'มีที่อยู่'], ['noaddr', 'ไม่มีที่อยู่'], ['photo', 'ยังมีรูปสลิป']].forEach(function(c) {
    var b = makeBtn('price-chip' + (/addr/.test(c[0]) ? ' addr-chip' : ''), c[1], function() {
      _slipView.filter = c[0]; syncChips(); draw();
    });
    b.type = 'button'; b.dataset.f = c[0]; chips.appendChild(b);
  });
  ctl.appendChild(chips);
  // Order slips no longer carry an address, so the address chips belong to the bill tab only
  function syncChips() {
    if (_slipView.cat === 'order' && /addr/.test(_slipView.filter)) _slipView.filter = 'all';
    chips.querySelectorAll('.price-chip').forEach(function(x) {
      x.classList.toggle('active', x.dataset.f === _slipView.filter);
      if (x.classList.contains('addr-chip')) x.hidden = _slipView.cat === 'order';
    });
  }
  syncChips();
  var sw = div('search-row'); sw.innerHTML = SVG_SEARCH;
  var si = document.createElement('input'); si.placeholder = 'ค้นหาชื่อ / ที่อยู่ / เลขอ้างอิง'; si.value = _slipView.q;
  si.oninput = function() { _slipView.q = si.value; draw(); };
  sw.appendChild(si); ctl.appendChild(sw);
  wrap.appendChild(ctl);

  var stats = div('stat-row'); wrap.appendChild(stats);
  // The "move slip" panel is a repair tool: hidden until a slip's "ย้าย" is pressed (or a slip is dragged)
  var lay = div('slip-layout');
  var listBox = div('section-card'); lay.appendChild(listBox);
  var panel = div('section-card slip-targets'); panel.hidden = true; lay.appendChild(panel);
  wrap.appendChild(lay);
  el('content').appendChild(wrap);
  var ctx = { picked: null, who: '', onChange: function() { draw(); drawSlipTargets(panel, ctx); }, close: closeMove };
  function pick(p) {
    ctx.picked = p; ctx.who = p.customer;
    panel.hidden = false; lay.classList.add('moving');
    drawSlipTargets(panel, ctx);
  }
  function closeMove() {
    ctx.picked = null; panel.hidden = true; lay.classList.remove('moving');
    listBox.querySelectorAll('.slip-row.picked').forEach(function(x) { x.classList.remove('picked'); });
  }

  function when(d) { return d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function draw() {
    var q = _slipView.q.trim().toLowerCase();
    var shown = pays.filter(function(p) {
      if (slipCat(p) !== _slipView.cat) return false;
      if (_slipView.list && p.listId !== _slipView.list) return false;
      if (_slipView.filter === 'addr' && !p.address) return false;
      if (_slipView.filter === 'noaddr' && p.address) return false;
      if (_slipView.filter === 'photo' && !p.hasSlip) return false;
      return !q || (p.customer + ' ' + p.address + ' ' + p.bankRef + ' ' + (names[p.listId] || '')).toLowerCase().indexOf(q) !== -1;
    });
    var total = 0, cust = {};
    shown.forEach(function(p) { total += Number(p.amount) || 0; cust[normCust(p.customer)] = true; });
    stats.innerHTML = '';
    stats.appendChild(makeStat('สลิป', shown.length, 'primary'));
    stats.appendChild(makeStat('ลูกค้า', Object.keys(cust).length, ''));
    stats.appendChild(makeStat('ยอดโอนรวม', fmt(total), 'success'));

    listBox.innerHTML = '';
    if (!shown.length) {
      var any = pays.some(function(p) { return slipCat(p) === _slipView.cat; });
      listBox.appendChild(div('state-empty', any ? 'ไม่พบสลิปตามที่ค้นหา'
        : _slipView.cat === 'bill' ? '&#x1F4ED; ยังไม่มีลูกค้าโอนบิลส่วนที่เหลือ + ค่าส่ง' : '&#x1F4ED; ยังไม่มีลูกค้าส่งสลิป'));
      return;
    }
    shown.forEach(function(p) {
      // Not a <button>: it holds the "ย้าย" button, and buttons can't nest
      var row = div('slip-row' + (ctx.picked === p ? ' picked' : ''));
      row.setAttribute('role', 'button'); row.tabIndex = 0;
      row.setAttribute('aria-label', 'ดูสลิปของ ' + p.customer);
      var main = div('slip-main');
      var top = div('slip-top');
      var nm = document.createElement('strong'); nm.textContent = p.customer; top.appendChild(nm);
      if (PAY_KIND[p.kind]) top.appendChild(payKindTag(p.kind));
      var ln = document.createElement('span'); ln.className = 'slip-listname'; ln.textContent = names[p.listId] || ''; top.appendChild(ln);
      main.appendChild(top);
      // Only bill slips are expected to carry the address
      if (p.address || p.deliveryId) {
        var addr = div('slip-addr' + (p.address ? '' : ' muted'));
        addr.textContent = p.address ? p.address.replace(/\s*\n\s*/g, ' · ') : 'ไม่ได้แนบที่อยู่';
        main.appendChild(addr);
      }
      var meta = div('slip-meta');
      meta.textContent = 'โอน ' + when(p.paidAt) + (p.bankRef ? ' · อ้างอิง ' + p.bankRef : '') + (p.hasSlip ? ' · 🖼 มีรูป' : '');
      main.appendChild(meta);
      row.appendChild(main);
      var side = div('slip-side');
      var amt = div('slip-amt'); amt.textContent = baht(p.amount); side.appendChild(amt);
      var mv = makeBtn('btn btn-ghost btn-sm', 'ย้าย', function(e) {
        e.stopPropagation(); pick(p);
        listBox.querySelectorAll('.slip-row.picked').forEach(function(x) { x.classList.remove('picked'); });
        row.classList.add('picked');
      });
      mv.type = 'button'; mv.title = 'ย้ายสลิปไปรายการ/บิลอื่น'; side.appendChild(mv);
      row.appendChild(side);
      row.onclick = function() { openPaymentsModal([p], p.customer); };
      row.onkeydown = function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.onclick(); } };
      dragSource(row, function() { pick(p); return { slip: p }; });
      listBox.appendChild(row);
    });
  }
  draw();
}

// ════════════════════════════════
// STATUS MANAGER — bulk status for web orders and imported old-sheet rows
// ════════════════════════════════
var _stm = { stage: 'pay', list: '', round: '', cat: '', q: '', legacy: null, bills: null };
var STM_CAP = 400; // rows drawn at once; filters narrow the rest

// Shipped / waiting / cancelled / custom label
function stmCat(o) {
  if (o.shippedAt || /^จัดส่งแล้ว/.test(o.status || '')) return 'จัดส่งแล้ว';
  return o.status || 'รอจัดส่ง';
}

// Old orders imported from the status sheet, with bulk status changes
function renderHistoryPanel() {
  setTopbar('ประวัติจากชีต', 'สถานะออเดอร์เก่าที่นำเข้าจาก Google Sheet');
  el('topbarActions').innerHTML = '';
  el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4E5; นำเข้าจากชีต', openImportStatusSheet));
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  if (_stm.legacy) { drawStatusManager(); return; }
  apiCall('adminGetLegacy').then(function(res) {
    if (currentPanel !== 'history') return;
    if (res.status !== 'Success') { el('content').innerHTML = ''; el('content').appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message || 'โหลดไม่สำเร็จ'))); return; }
    _stm.legacy = (res.rows || []).map(function(o) { o.shippedAt = ''; return o; });
    _stm.legacyMissing = !!res.missing;
    drawStatusManager();
  });
}

function drawStatusManager() {
  var items = _stm.legacy || [];
  el('content').innerHTML = '';
  var wrap = document.createElement('div');

  var ctl = div('section-card slip-ctl');

  if (!items.length) {
    wrap.appendChild(ctl);
    var empty = 'ยังไม่ได้นำเข้าชีตสถานะ — กด "📥 นำเข้าจากชีต" ด้านบน' + (_stm.legacyMissing ? '<br><small>(ต้องรัน supabase/migrations/2026-10-29b-legacy-status.sql ก่อน)</small>' : '');
    wrap.appendChild(div('state-empty', empty));
    el('content').appendChild(wrap); return;
  }

  // Round + status dropdowns (old sheet has ~30 labels, too many for chips)
  var rounds = [], seenR = {}, cats = {};
  items.forEach(function(o) {
    if (!seenR[o.round]) { seenR[o.round] = true; rounds.push(o.round); }
    var c = stmCat(o); cats[c] = (cats[c] || 0) + 1;
  });
  function select(label, opts, val, onChange) {
    var s = document.createElement('select'); s.className = 'slip-list'; s.setAttribute('aria-label', label);
    opts.forEach(function(o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; s.appendChild(e); });
    s.value = val; s.onchange = function() { onChange(s.value); };
    return s;
  }
  if (!seenR[_stm.round]) _stm.round = '';
  if (!cats[_stm.cat]) _stm.cat = '';
  ctl.appendChild(select('รอบ', [['', 'ทุกรอบ']].concat(rounds.map(function(r) { return [r, r || '(ไม่มีชื่อ)']; })), _stm.round,
    function(v) { _stm.round = v; draw(); }));
  var order = ['รอจัดส่ง', 'จัดส่งแล้ว', 'ยกเลิก'];
  var catKeys = Object.keys(cats).sort(function(a, b) {
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || cats[b] - cats[a];
  });
  ctl.appendChild(select('สถานะ', [['', 'ทุกสถานะ (' + items.length + ')']].concat(catKeys.map(function(c) { return [c, c.replace(/\s+/g, ' ') + ' (' + cats[c] + ')']; })), _stm.cat,
    function(v) { _stm.cat = v; draw(); }));
  var sw = div('search-row'); sw.innerHTML = SVG_SEARCH;
  var si = document.createElement('input'); si.placeholder = 'ค้นหาชื่อ / สินค้า / เลขพัสดุ'; si.value = _stm.q;
  si.oninput = function() { _stm.q = si.value; draw(); };
  sw.appendChild(si); ctl.appendChild(sw);
  wrap.appendChild(ctl);

  var stats = div('stat-row'); wrap.appendChild(stats);
  var card = div('section-card');
  var list = div('stm-list'); card.appendChild(list);
  var bar = div('sticky-save-bar obar');
  var allLbl = document.createElement('label'); allLbl.className = 'obar-all';
  var allChk = document.createElement('input'); allChk.type = 'checkbox';
  allLbl.appendChild(allChk); allLbl.appendChild(document.createTextNode(' ทั้งหมด'));
  bar.appendChild(allLbl);
  var selInfo = document.createElement('span'); selInfo.className = 'save-count'; bar.appendChild(selInfo);
  var applyBtn = makeBtn('btn btn-primary btn-sm', '&#x1F4E6; เปลี่ยนสถานะ', function() {
    var chosen = shown.filter(function(o) { return picked[o.id]; });
    if (!chosen.length) return;
    openStatusModal(chosen, {
      noPick: true,
      api: 'adminSetLegacyStatus',
      labels: Object.keys(cats).filter(function(c) { return order.indexOf(c) === -1; }),
      after: function() { picked = {}; drawStatusManager(); }
    });
  });
  bar.appendChild(applyBtn);
  card.appendChild(bar);
  wrap.appendChild(card);
  el('content').appendChild(wrap);

  var picked = {}, shown = [];
  function refreshBar() {
    var n = shown.filter(function(o) { return picked[o.id]; }).length;
    selInfo.textContent = n ? 'เลือก ' + n + ' รายการ' : 'ยังไม่ได้เลือก';
    selInfo.className = 'save-count' + (n ? ' has-changes' : '');
    applyBtn.disabled = !n;
    allChk.checked = n > 0 && n === shown.length; allChk.indeterminate = n > 0 && n < shown.length;
  }
  allChk.onchange = function() {
    shown.forEach(function(o) { picked[o.id] = allChk.checked; });
    list.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = allChk.checked; cb.indeterminate = false; });
    refreshBar();
  };

  function stmStatus(o) {
    var c = stmCat(o);
    var st = div('oitem-ship' + (c === 'จัดส่งแล้ว' ? '' : c === 'ยกเลิก' ? ' cancel' : c === 'รอจัดส่ง' ? ' waiting' : ' custom'));
    st.textContent = (c === 'จัดส่งแล้ว' ? '📦 ' : '') + (o.shippedAt ? 'ส่งแล้ว' : o.status || 'รอจัดส่ง') + (o.tracking ? ' · ' + o.tracking : '');
    return st;
  }

  function draw() {
    var q = _stm.q.trim().toLowerCase();
    shown = items.filter(function(o) {
      if (_stm.round && o.round !== _stm.round) return false;
      if (_stm.cat && stmCat(o) !== _stm.cat) return false;
      return !q || (o.customer + ' ' + o.product + ' ' + (o.tracking || '') + ' ' + (o.status || '')).toLowerCase().indexOf(q) !== -1;
    });
    var cust = {}, waiting = 0;
    shown.forEach(function(o) { cust[normCust(o.customer)] = true; if (stmCat(o) === 'รอจัดส่ง') waiting++; });
    stats.innerHTML = '';
    stats.appendChild(makeStat('รายการ', shown.length, 'primary'));
    stats.appendChild(makeStat('ลูกค้า', Object.keys(cust).length, ''));
    stats.appendChild(makeStat('รอจัดส่ง', waiting, ''));

    list.innerHTML = '';
    if (!shown.length) { list.appendChild(div('state-empty', 'ไม่พบรายการตามที่กรอง')); refreshBar(); return; }
    var rows = shown.slice(0, STM_CAP);
    rows.forEach(function(o) {
      var row = document.createElement('label'); row.className = 'stm-row';
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!picked[o.id];
      cb.onchange = function() { picked[o.id] = cb.checked; refreshBar(); };
      row.appendChild(cb);
      var main = div('stm-main');
      var top = div('slip-top');
      var nm = document.createElement('strong'); nm.textContent = o.customer.replace(/\s*\n\s*/g, ' '); top.appendChild(nm);
      var rn = document.createElement('span'); rn.className = 'slip-listname'; rn.textContent = o.round; top.appendChild(rn);
      main.appendChild(top);
      var pr = div('stm-product'); pr.textContent = o.product + ' ×' + o.qty; main.appendChild(pr);
      main.appendChild(stmStatus(o));
      row.appendChild(main);
      list.appendChild(row);
    });
    if (shown.length > STM_CAP) list.appendChild(div('state-empty', 'แสดง ' + STM_CAP + ' จาก ' + shown.length + ' รายการ — เลือก "ทั้งหมด" จะเลือกครบทุกรายการที่กรองไว้ หรือกรองให้แคบลง'));
    refreshBar();
  }
  draw();
}

// ════════════════════════════════
// STATUS STAGES — the same steps the customer sees on the status page:
// waiting for payment → arrived / send the bill → waiting to ship (iShip
// books the parcel) → tracking → complete. POS sales never show here.
// ════════════════════════════════
var ARRIVED_LABEL = 'ถึงไทยแล้ว';
var ARRIVED_RE = /ถึงไทย/;
// Paid another way (no slip): the admin marks it, and it counts like a slip for step 2.
// Arrived items count too. Same rule on the customer page (status.js webStage).
var PAID_LABEL = 'ชำระแล้ว';
var PAID_RE = /ชำระแล้ว|ถึงไทย/;
var _billDrag = null; // { ids, cust, from: 'left' | 'wait' | 'bill', key, bill }
var STAGES = [
  { id: 'pay', label: 'รอชำระเงิน', empty: 'ไม่มีออเดอร์ที่รอชำระเงิน' },
  { id: 'arrive', label: 'ถึงไทย / ส่งบิล', empty: '' },
  { id: 'ship', label: 'รอจัดส่ง', empty: 'ไม่มีบิลที่รอจัดส่ง — บิลจะย้ายมาที่นี่เมื่อลูกค้าโอนค่าบิลแล้ว' },
  { id: 'track', label: 'ติดตามพัสดุ', empty: 'ไม่มีพัสดุที่กำลังจัดส่ง' },
  { id: 'done', label: 'สำเร็จแล้ว', empty: 'ยังไม่มีรายการที่สำเร็จ' }
];
var STAGE_CAP = 60; // cards drawn at once; search narrows the rest

// iShip's last step says the parcel reached the customer
function isDelivered(b) {
  return !!b.deliveredAt || /^(delivered|complete|completed|signed|success_delivery)$/i.test(b.ishipCode || '') ||
    /นำจ่ายสำเร็จ|จัดส่งสำเร็จ|ส่งสำเร็จ|ผู้รับได้รับ|เซ็นรับ/.test(b.ishipStatus || '');
}

function stageOf(o, B) {
  if (o.status === 'ยกเลิก') return 'done';
  var b = o.deliveryId ? B.billById[o.deliveryId] : null;
  // Parcels booked with iShip stay in tracking until iShip says delivered
  if (o.shippedAt) return b && b.tracking && !isDelivered(b) ? 'track' : 'done';
  // A sent bill waits in step 2 until the customer pays it
  if (b) return b.sentAt && B.billPaid[b.id] ? 'ship' : 'arrive';
  return B.paid[o.listId + '|' + normCust(o.customer)] || PAID_RE.test(o.status || '') ? 'arrive' : 'pay';
}

function renderStatusPanel() {
  setTopbar('จัดการสถานะ', 'ขั้นตอนเดียวกับหน้าสถานะของลูกค้า');
  el('topbarActions').innerHTML = '';
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  // Bill settings are optional: a failed load just means the built-in message and no default fee
  Promise.all([apiCall('adminGetAllOrders'), apiCall('adminGetDeliveries'), loadBillSettings()]).then(function(r) {
    if (currentPanel !== 'status') return;
    var bad = r[0].status !== 'Success' ? r[0] : r[1].status !== 'Success' ? r[1] : null;
    if (bad) { el('content').innerHTML = ''; el('content').appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(bad.message || 'โหลดไม่สำเร็จ'))); return; }
    _stm.bills = {
      // POS sales are handed over at the counter: nothing to ship or track
      orders: (r[0].orders || []).filter(function(o) { return o.remark !== 'POS'; }),
      payments: r[0].payments || [], deliveries: r[1].deliveries || [], missing: !!r[1].missing
    };
    _slipTargets = null;
    drawStages();
  });
}

function drawStages() {
  var B = _stm.bills;
  el('content').innerHTML = '';
  var wrap = document.createElement('div');
  el('content').appendChild(wrap);
  if (B.missing) {
    wrap.appendChild(div('state-empty', 'ต้องรันไฟล์ supabase/migrations/2026-10-29c-delivery-bills.sql ใน SQL Editor ก่อน'));
    return;
  }
  B.billById = {}; B.deliveries.forEach(function(b) { B.billById[b.id] = b; });
  B.paid = {}; B.billPaid = {};
  B.payments.forEach(function(p) {
    if (p.deliveryId) B.billPaid[p.deliveryId] = true;
    else B.paid[p.listId + '|' + normCust(p.customer)] = true;
  });
  var listName = {};
  B.orders.forEach(function(o) { listName[o.listId] = o.shopName; });
  // Order-list filter: narrows every step and its count
  if (_stm.list && !listName[_stm.list]) _stm.list = '';
  function inList(o) { return !_stm.list || o.listId === _stm.list; }
  var S = {};
  STAGES.forEach(function(s) { S[s.id] = []; });
  B.orders.filter(inList).forEach(function(o) { S[stageOf(o, B)].push(o); });

  function ckKey(o) { return o.checkoutId ? 'c:' + o.checkoutId : 't:' + o.listId + '|' + o.customer + '|' + String(o.timestamp || '').slice(0, 16); }
  function checkouts(rows) {
    var out = [], by = {};
    rows.forEach(function(o) { var k = ckKey(o); if (!by[k]) { by[k] = []; out.push(by[k]); } by[k].push(o); });
    return out.sort(function(a, b) { return String(b[0].shippedAt || b[0].timestamp).localeCompare(String(a[0].shippedAt || a[0].timestamp)); });
  }
  function billsOf(rows) {
    var seen = {}, out = [];
    rows.forEach(function(o) { if (!seen[o.deliveryId]) { seen[o.deliveryId] = true; out.push(B.billById[o.deliveryId]); } });
    return out.map(billCtx);
  }
  function billCtx(b) {
    return { b: b, items: B.orders.filter(function(o) { return o.deliveryId === b.id; }),
             pays: B.payments.filter(function(p) { return p.deliveryId === b.id; }) };
  }
  function drafts() {
    return B.deliveries.filter(function(b) { return !b.sentAt && !b.tracking; }).map(billCtx)
      .filter(function(x) { return !_stm.list || x.items.some(inList); });
  }
  // Sent, not paid yet, still something to ship
  function unpaid() { return billsOf(S.arrive.filter(function(o) { return o.deliveryId && B.billById[o.deliveryId].sentAt; })); }
  function count(id) {
    if (id === 'ship' || id === 'track') return billsOf(S[id]).length;
    if (id === 'arrive') return checkouts(S.arrive.filter(function(o) { return !o.deliveryId; })).length + drafts().length + unpaid().length;
    return checkouts(S[id]).length;
  }

  // Step tabs, with how many checkouts / bills sit in each
  var ctl = div('section-card slip-ctl');
  var tabs = div('stg-tabs'); tabs.setAttribute('role', 'tablist');
  STAGES.forEach(function(s, i) {
    var b = makeBtn('stg-tab' + (s.id === _stm.stage ? ' on' : ''),
      '<span class="stg-num">' + (i + 1) + '</span><span>' + escapeHtml(s.label) + '</span><span class="stg-count">' + count(s.id) + '</span>',
      function() { if (_stm.stage !== s.id) { _stm.stage = s.id; drawStages(); } });
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', s.id === _stm.stage ? 'true' : 'false');
    tabs.appendChild(b);
  });
  ctl.appendChild(tabs);
  var ls = document.createElement('select'); ls.className = 'slip-list stg-list'; ls.setAttribute('aria-label', 'รายการสั่งซื้อ');
  [['', 'ทุกรายการสั่งซื้อ']].concat(Object.keys(listName).map(function(id) { return [id, listName[id] || '(ไม่มีชื่อ)']; })
    .sort(function(a, b) { return a[1].localeCompare(b[1], 'th'); }))
    .forEach(function(o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; ls.appendChild(e); });
  ls.value = _stm.list || '';
  ls.onchange = function() { _stm.list = ls.value; drawStages(); };
  ctl.appendChild(ls);
  var sw = div('search-row'); sw.innerHTML = SVG_SEARCH;
  var si = document.createElement('input'); si.placeholder = 'ค้นหาชื่อลูกค้า / สินค้า / เลขพัสดุ'; si.value = _stm.q;
  si.oninput = function() { _stm.q = si.value; draw(); };
  sw.appendChild(si); ctl.appendChild(sw);
  wrap.appendChild(ctl);
  var body = div('stg-body'); wrap.appendChild(body);

  function q() { return _stm.q.trim().toLowerCase(); }
  function hit(o) {
    var t = q();
    return !t || (o.customer + ' ' + o.product + ' ' + (o.tracking || '') + ' ' + (listName[o.listId] || '')).toLowerCase().indexOf(t) !== -1;
  }
  function custName(items) { return items[0].customer.replace(/\s*\n\s*/g, ' '); }
  function ids(items) { return items.map(function(o) { return o.id; }); }
  function unique(a) { return a.filter(function(v, i) { return a.indexOf(v) === i; }); }
  function when(d) { return d ? new Date(d).toLocaleDateString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function more(n) { if (n > STAGE_CAP) body.appendChild(div('slip-meta', 'แสดง ' + STAGE_CAP + ' จาก ' + n + ' — ค้นหาให้แคบลง')); }
  function empty(text) { body.appendChild(div('state-empty', q() ? 'ไม่พบรายการตามที่ค้นหา' : text)); }

  function itemStatus(o) {
    var b = o.deliveryId ? B.billById[o.deliveryId] : null;
    if (o.status === 'ยกเลิก') return div('oitem-ship cancel', 'ยกเลิก');
    if (o.shippedAt) {
      var t = (b && b.tracking && isDelivered(b) ? '✓ ส่งถึงแล้ว' : '📦 ส่งแล้ว') + (o.tracking ? ' · ' + (o.courier ? Couriers.name(o.courier) + ' ' : '') + o.tracking : '');
      var s = div('oitem-ship'); s.textContent = t; return s;
    }
    var w = div('oitem-ship ' + (o.status ? 'custom' : 'waiting')); w.textContent = o.status || 'รอสินค้า'; return w;
  }
  function payTag(o) {
    return o.payType === 'Deposit'
      ? '<span class="badge badge-deposit">มัดจำ</span> ราคาเต็ม ' + escapeHtml(baht(o.totalFull || o.fullPrice * o.qty))
      : o.payType === 'Gift' ? '<span class="badge badge-gift">ของแถม</span>' : '<span class="badge badge-full">จ่ายเต็ม</span>';
  }
  // One checkout as a card, like the orders page
  function orderCard(g) {
    var o0 = g[0], sum = 0, pcs = 0;
    var c = div('ocard');
    var head = div('ocard-head');
    var who = div('ocard-who');
    var nm = document.createElement('span'); nm.className = 'ocard-name'; nm.textContent = custName(g); who.appendChild(nm);
    var sub = div('ocard-sub');
    var shop = document.createElement('span'); shop.className = 'ocard-shop'; shop.textContent = listName[o0.listId] || ''; sub.appendChild(shop);
    who.appendChild(sub); head.appendChild(who);
    head.appendChild(div('ocard-time', escapeHtml(when(o0.timestamp))));
    c.appendChild(head);
    var box = div('ocard-items');
    g.forEach(function(o) {
      sum += Number(o.total) || 0; if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
      var it = div('oitem');
      var info = div('oitem-info');
      var pn = div('oitem-name'); pn.textContent = o.product; info.appendChild(pn);
      info.appendChild(div('oitem-sub', payTag(o)));
      info.appendChild(itemStatus(o));
      it.appendChild(info);
      it.appendChild(div('oitem-qty', '×' + escapeHtml(String(o.qty))));
      it.appendChild(div('oitem-price', escapeHtml(baht(o.total))));
      box.appendChild(it);
    });
    c.appendChild(box);
    var foot = div('ocard-foot');
    foot.appendChild(div('ocard-count', g.length + ' รายการ · ' + pcs + ' ชิ้น'));
    foot.appendChild(div('ocard-total', 'รวม <strong>' + escapeHtml(baht(sum)) + '</strong>'));
    c.appendChild(foot);
    return c;
  }
  // One compact row: product (without the list name the card already shows), qty, and a tag
  // only when something is still owed or it's a gift — "paid in full" is the norm
  function itemLine(o) {
    var row = div('bill-item');
    var name = String(o.product || ''), ln = listName[o.listId] || '';
    if (ln && name.indexOf(ln) === 0 && name.length > ln.length) name = name.slice(ln.length).replace(/^[\s\-–·:|]+/, '');
    var t = div('bill-item-name'); t.textContent = name; t.title = o.product; row.appendChild(t);
    var qn = document.createElement('span'); qn.className = 'bill-item-qty'; qn.textContent = '×' + o.qty; row.appendChild(qn);
    if (o.payType === 'Deposit' || o.payType === 'Gift') {
      var m = document.createElement('span'); m.className = 'bill-item-tag ' + o.payType.toLowerCase();
      m.textContent = o.payType === 'Gift' ? 'ของแถม' : 'มัดจำ · เหลือ ' + baht(Math.max(0, o.totalFull - o.total));
      row.appendChild(m);
    }
    return row;
  }
  // Long bills show the first few items; the rest open on tap
  var ITEMS_SHOWN = 4;
  function itemList(card, items, drag) {
    var box = div('bill-items');
    items.forEach(function(o, i) {
      var line = itemLine(o);
      if (drag) drag(line, o);
      if (i >= ITEMS_SHOWN && items.length > ITEMS_SHOWN + 1) line.hidden = true;
      box.appendChild(line);
    });
    card.appendChild(box);
    var hidden = box.querySelectorAll('.bill-item[hidden]');
    if (!hidden.length) return;
    var more = makeBtn('bill-more', '+ อีก ' + hidden.length + ' รายการ', function() {
      hidden.forEach(function(l) { l.hidden = false; }); more.remove();
    });
    more.type = 'button'; card.appendChild(more);
  }
  // Items, rest of the price + fee; the fee is editable only while the bill is a draft
  function billSum(x) {
    var b = x.b, rest = 0, pcs = 0;
    x.items.forEach(function(o) {
      if (o.payType === 'Deposit') rest += Math.max(0, o.totalFull - o.total);
      if (o.payType !== 'Gift') pcs += Number(o.qty) || 0;
    });
    var sum = div('bill-sum');
    var r1 = div('bill-sum-row');
    r1.appendChild(document.createTextNode(pcs + ' ชิ้น · ส่วนที่เหลือ'));
    var rv = document.createElement('span'); rv.textContent = baht(rest); r1.appendChild(rv);
    sum.appendChild(r1);
    var r2 = div('bill-sum-row');
    var fl = document.createElement('label'); fl.textContent = 'ค่าส่ง'; fl.htmlFor = 'fee-' + b.id; r2.appendChild(fl);
    if (!b.sentAt) {
      var fee = document.createElement('input'); fee.type = 'number'; fee.min = '0'; fee.step = '1'; fee.inputMode = 'decimal';
      fee.id = 'fee-' + b.id; fee.className = 'bill-fee'; fee.placeholder = 'ยังไม่ระบุ';
      fee.value = b.fee === null ? '' : b.fee;
      fee.onchange = function() {
        var v = fee.value.trim() === '' ? null : Number(fee.value);
        apiCall('adminSetDeliveryFee', b.id, v).then(function(res) {
          if (res.status !== 'Success') { toast(res.message || 'บันทึกค่าส่งไม่สำเร็จ', 'error'); fee.value = b.fee === null ? '' : b.fee; return; }
          b.fee = res.fee; toast('บันทึกค่าส่งแล้ว', 'success'); draw();
        });
      };
      r2.appendChild(fee);
    } else {
      var fv = document.createElement('span'); fv.textContent = baht(b.fee); r2.appendChild(fv);
    }
    sum.appendChild(r2);
    var r3 = div('bill-sum-row total');
    r3.appendChild(document.createTextNode('ลูกค้าต้องโอน'));
    var tv = document.createElement('strong'); tv.textContent = b.fee === null ? 'รอใส่ค่าส่ง' : baht(rest + b.fee); r3.appendChild(tv);
    sum.appendChild(r3);
    return sum;
  }
  function paidButton(x) {
    var paid = 0; x.pays.forEach(function(p) { paid += Number(p.amount) || 0; });
    var ps = makeBtn('bill-paid' + (x.pays.length ? ' ok' : ''), x.pays.length ? '✓ โอนแล้ว ' + baht(paid) + ' · ดูสลิป' : 'รอลูกค้าโอน', null);
    ps.type = 'button';
    if (x.pays.length) ps.onclick = function() { openPaymentsModal(x.pays, x.items.length ? custName(x.items) : x.b.customer); };
    else ps.disabled = true;
    return ps;
  }
  // Chat message for the bill: items, rest + fee, how to pay, delivery rounds
  function summaryBtn(x, cls) {
    var s = makeBtn(cls, '&#x1F4AC; ข้อความสรุปยอด', function() {
      openBillSummary(x.items, x.b.fee, x.items.length ? custName(x.items) : '@' + x.b.customer);
    });
    s.type = 'button';
    if (x.b.fee === null) { s.disabled = true; s.title = 'ใส่ค่าส่งก่อน'; }
    return s;
  }
  function billTitle(x) {
    var names = unique(x.items.map(function(o) { return listName[o.listId] || ''; })).filter(Boolean);
    return (x.items.length ? custName(x.items) : '@' + x.b.customer) + (names.length ? ' · ' + names.join(', ') : '');
  }
  function tools() {
    var t = div('bill-tools');
    [['&#x2699;&#xFE0F; ตั้งค่าผู้ส่ง iShip', openIshipSettings], ['&#x1F69A; เรียกรถเข้ารับ', openPickupModal]].forEach(function(a) {
      var b = makeBtn('btn btn-ghost btn-sm', a[0], a[1]); b.type = 'button'; t.appendChild(b);
    });
    return t;
  }

  // ── 1. Waiting for payment: no slip for the list yet ──
  function drawPay() {
    var gs = checkouts(S.pay.filter(hit));
    if (!gs.length) return empty(STAGES[0].empty);
    var grid = div('stg-grid');
    gs.slice(0, STAGE_CAP).forEach(function(g) {
      var c = orderCard(g);
      var act = div('ocard-ship');
      act.appendChild(div('ocard-ship-info stg-wait', 'ยังไม่ได้รับสลิป'));
      var ed = makeBtn('btn btn-ghost btn-sm', 'แก้ไขสถานะ', function() { openStatusModal(g, { after: renderStatusPanel }); });
      ed.type = 'button'; act.appendChild(ed);
      // e.g. paid in cash or by another transfer the customer didn't upload
      var paid = makeBtn('btn btn-primary btn-sm', '&#x2713; ชำระแล้ว &#x2192;', function() { markPaid(g); });
      paid.type = 'button'; paid.title = 'ย้ายไปขั้น "ถึงไทย / ส่งบิล" โดยไม่ต้องรอสลิป'; act.appendChild(paid);
      c.appendChild(act);
      grid.appendChild(c);
    });
    body.appendChild(grid); more(gs.length);
  }

  // ── 2. Paid: mark arrival, build bills by drag and drop, send them ──
  function drawArrive() {
    var bar = div('bill-tools stg-arrive-bar');
    bar.appendChild(div('slip-meta bill-help mouse-only',
      'ลากออเดอร์ (หรือทีละชิ้น) ไปทางขวาเพื่อทำบิล · วางบนบิลเพื่อรวม · ลากกลับมาทางซ้ายเพื่อนำออก'));
    var set = makeBtn('btn btn-ghost btn-sm', '&#x2699;&#xFE0F; ตั้งค่าบิล' + (_billSet.fee !== null ? ' · ค่าส่ง ' + escapeHtml(baht(_billSet.fee)) : ''),
      function() { openBillSettings(drawStages); });
    set.type = 'button'; set.title = 'ค่าส่งเริ่มต้น และข้อความสรุปยอด'; bar.appendChild(set);
    body.appendChild(bar);
    var board = div('bill-board');
    var left = div('bill-col'), right = div('bill-col bill-col-right');
    board.appendChild(left); board.appendChild(right);
    body.appendChild(board);

    function byCustomer(rows) {
      var custs = [], by = {};
      rows.forEach(function(o) {
        var c = normCust(o.customer);
        if (!by[c]) { by[c] = { keys: [], byKey: {} }; custs.push(c); }
        var key = o.checkoutId || o.listId + '|' + o.timestamp;
        if (!by[c].byKey[key]) { by[c].byKey[key] = []; by[c].keys.push(key); }
        by[c].byKey[key].push(o);
      });
      return custs.sort().map(function(c) { return { c: c, g: by[c] }; });
    }
    function orderBlock(host, c, key, items, from) {
      var card = div('bill-order' + (from === 'wait' ? ' stg-notyet' : ''));
      var top = div('bill-order-top');
      var nm = document.createElement('strong');
      nm.textContent = (listName[items[0].listId] || 'ออเดอร์') + ' · ' +
        new Date(items[0].timestamp).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
      top.appendChild(nm);
      if (from === 'wait') {
        var ar = makeBtn('btn btn-ghost btn-sm', '&#x2713; ถึงไทยแล้ว', function() { markArrived(items, 'อัปเดตเป็นถึงไทยแล้ว'); });
        ar.type = 'button'; top.appendChild(ar);
      } else {
        // Tap fallback for touch screens, where drag and drop doesn't work
        var go = makeBtn('btn btn-ghost btn-sm touch-only', 'สร้างบิล &#x2192;', function() { setBill(ids(items), null, true, c); });
        go.type = 'button'; go.title = 'ย้ายทั้งออเดอร์ไปเป็นบิลใหม่'; top.appendChild(go);
      }
      card.appendChild(top);
      itemList(card, items, function(line, o) {
        dragSource(line, function() { return { ids: [o.id], cust: c, from: from, key: key + '#' + o.id }; });
      });
      dragSource(card, function() { return { ids: ids(items), cust: c, from: from, key: key }; });
      // Another order dropped on this one → both become one bill
      if (from === 'left') dropZone(card, function(d) {
        if (d.from === 'bill') { setBill(d.ids, null, false, d.cust); return; }
        if (d.key === key || d.key.indexOf(key + '#') === 0) return;
        if (d.cust !== c) { toast('รวมบิลได้เฉพาะสินค้าของลูกค้าคนเดียวกัน', 'error'); return; }
        setBill(unique(d.ids.concat(ids(items))), null, true, c);
      });
      host.appendChild(card);
    }
    function column(host, rows, from) {
      byCustomer(rows).forEach(function(x) {
        var box = div('bill-cust');
        var h = div('bill-cust-name'); h.textContent = custName(x.g.byKey[x.g.keys[0]]); box.appendChild(h);
        x.g.keys.forEach(function(key) { orderBlock(box, x.c, key, x.g.byKey[key], from); });
        host.appendChild(box);
      });
    }

    var open = S.arrive.filter(function(o) { return !o.deliveryId && hit(o); });
    var arrived = open.filter(function(o) { return ARRIVED_RE.test(o.status || ''); });
    var notYet = open.filter(function(o) { return !ARRIVED_RE.test(o.status || ''); });
    left.appendChild(div('bill-col-title', '📦 ถึงไทยแล้ว · ยังไม่มีบิล'));
    var arrivedBox = div('stg-drop');
    if (!arrived.length) arrivedBox.appendChild(div('state-empty', q() ? 'ไม่พบรายการตามที่ค้นหา' : 'ยังไม่มีสินค้าที่ถึงไทยและรอทำบิล'));
    column(arrivedBox, arrived, 'left');
    left.appendChild(arrivedBox);
    // Dropping a not-yet-arrived order here marks it arrived
    dropZone(arrivedBox, function(d) {
      if (d.from === 'wait') markArrived(B.orders.filter(function(o) { return d.ids.indexOf(o.id) !== -1; }), 'อัปเดตเป็นถึงไทยแล้ว');
    });
    if (notYet.length) {
      left.appendChild(div('bill-col-title stg-sub', '⏳ ชำระแล้ว · รอสินค้าถึงไทย (' + checkouts(notYet).length + ')'));
      column(left, notYet, 'wait');
    }

    right.appendChild(div('bill-col-title', '🧾 บิลร่าง · ลูกค้าเห็นบิลเมื่อกด "ส่งบิลให้ลูกค้า"'));
    var t = q();
    var bills = drafts().filter(function(x) { return !t || x.items.some(hit) || x.b.customer.indexOf(t) !== -1; });
    if (!bills.length) right.appendChild(div('state-empty', 'ลากออเดอร์จากทางซ้ายมาวางที่นี่เพื่อสร้างบิล'));
    var n = {};
    bills.sort(function(a, b) { return a.b.customer < b.b.customer ? -1 : a.b.customer > b.b.customer ? 1 : 0; }).forEach(function(x) {
      var b = x.b; n[b.customer] = (n[b.customer] || 0) + 1;
      var card = div('bill-card draft');
      var top = div('bill-order-top');
      var nm = document.createElement('strong');
      // List names in the title, since item rows leave them out
      nm.textContent = billTitle(x) + (n[b.customer] > 1 ? ' · บิล ' + n[b.customer] : '');
      top.appendChild(nm);
      card.appendChild(top);
      itemList(card, x.items, function(line, o) {
        dragSource(line, function() { return { ids: [o.id], cust: b.customer, from: 'bill', bill: b.id }; });
      });
      dragSource(card, function() { return { ids: ids(x.items), cust: b.customer, from: 'bill', bill: b.id }; });
      card.appendChild(billSum(x));
      card.appendChild(div('slip-meta bill-state', 'ร่าง · ลูกค้ายังไม่เห็นบิลนี้'));
      var send = makeBtn('btn btn-primary btn-sm bill-send', '&#x1F4E8; ส่งบิลให้ลูกค้า', function() { sendBill(b, true); });
      send.type = 'button';
      if (b.fee === null) { send.disabled = true; send.title = 'ใส่ค่าส่งก่อน'; }
      card.appendChild(send);
      card.appendChild(summaryBtn(x, 'btn btn-ghost btn-sm bill-send'));
      dropZone(card, function(d) {
        if (d.bill === b.id) return;
        if (d.cust !== b.customer) { toast('รวมบิลได้เฉพาะสินค้าของลูกค้าคนเดียวกัน', 'error'); return; }
        setBill(d.ids, b.id, false, d.cust);
      });
      right.appendChild(card);
    });

    // Sent bills stay in this step until the customer sends the slip; then they move to "รอจัดส่ง".
    // Full width under the board: nothing is dragged here
    var waiting = unpaid().filter(function(x) { return !t || x.items.some(hit) || x.b.customer.indexOf(t) !== -1; });
    if (waiting.length) {
      body.appendChild(div('stg-section-title', '📨 ส่งบิลแล้ว · รอลูกค้าโอน <span class="stg-count">' + waiting.length + '</span>'));
      var grid = div('stg-grid');
      body.appendChild(grid);
      waiting.forEach(function(x) {
        var b = x.b;
        var card = div('bill-card stg-bill');
        var top = div('bill-order-top');
        var nm = document.createElement('strong'); nm.textContent = billTitle(x); top.appendChild(nm);
        top.appendChild(div('slip-meta', escapeHtml('ส่งบิล ' + when(b.sentAt))));
        card.appendChild(top);
        itemList(card, x.items);
        card.appendChild(billSum(x));
        card.appendChild(paidButton(x));
        card.appendChild(summaryBtn(x, 'btn btn-ghost btn-sm bill-send'));
        var act = div('stg-actions');
        var un = makeBtn('btn btn-ghost btn-sm', 'ถอนบิล', function() { sendBill(b, false); });
        un.type = 'button'; un.title = 'ซ่อนบิลจากลูกค้า กลับเป็นร่าง'; act.appendChild(un);
        // e.g. paid in cash or another way
        var go = makeBtn('btn btn-ghost btn-sm', '&#x1F69A; จัดส่งเลย (ไม่รอโอน)', function() {
          askConfirm('ลูกค้ายังไม่ได้ส่งสลิปค่าบิลนี้ — จัดส่งเลยไหม?', 'จัดส่งเลย').then(function(ok) {
            if (ok) openIshipModal(b, x, renderStatusPanel);
          });
        });
        go.type = 'button'; act.appendChild(go);
        card.appendChild(act);
        grid.appendChild(card);
      });
    }

    // Empty space on the right → new bill; on the left → out of its bill
    dropZone(right, function(d) { setBill(d.ids, null, true, d.cust); });
    dropZone(left, function(d) { if (d.from === 'bill') setBill(d.ids, null, false, d.cust); });
  }

  // ── 3. Bill sent: the one action is "deliver", which books iShip ──
  function drawShip() {
    body.appendChild(tools());
    var t = q();
    var bills = billsOf(S.ship).filter(function(x) { return !t || x.items.some(hit); });
    if (!bills.length) return empty(STAGES[2].empty);
    var grid = div('stg-grid');
    bills.slice(0, STAGE_CAP).forEach(function(x) {
      var b = x.b;
      var card = div('bill-card stg-bill');
      var top = div('bill-order-top');
      var nm = document.createElement('strong'); nm.textContent = billTitle(x); top.appendChild(nm);
      top.appendChild(div('slip-meta', escapeHtml('ส่งบิล ' + when(b.sentAt))));
      card.appendChild(top);
      itemList(card, x.items);
      card.appendChild(billSum(x));
      card.appendChild(paidButton(x));
      var act = div('stg-actions');
      var go = makeBtn('btn btn-primary btn-sm', '&#x1F69A; จัดส่ง', function() { openIshipModal(b, x, renderStatusPanel); });
      go.type = 'button'; act.appendChild(go);
      card.appendChild(act);
      grid.appendChild(card);
    });
    body.appendChild(grid); more(bills.length);
  }

  // ── 4. Booked with iShip, not delivered yet ──
  function drawTrack() {
    var t = q();
    var bills = billsOf(S.track).filter(function(x) { return !t || x.items.some(hit) || (x.b.tracking || '').toLowerCase().indexOf(t) !== -1; });
    if (!bills.length) return empty(STAGES[3].empty);
    var bar = div('bill-tools');
    var all = makeBtn('btn btn-ghost btn-sm', '&#x1F504; เช็คสถานะทั้งหมด (' + bills.length + ')', function() { refreshAll(bills, all); });
    all.type = 'button'; bar.appendChild(all);
    var pk = makeBtn('btn btn-ghost btn-sm', '&#x1F69A; เรียกรถเข้ารับ', openPickupModal); pk.type = 'button'; bar.appendChild(pk);
    body.appendChild(bar);
    var grid = div('stg-grid');
    bills.slice(0, STAGE_CAP).forEach(function(x) {
      var b = x.b;
      var card = div('bill-card stg-bill');
      var top = div('bill-order-top');
      var nm = document.createElement('strong'); nm.textContent = billTitle(x); top.appendChild(nm);
      card.appendChild(top);
      var tr = div('stg-track');
      var a = document.createElement('a'); a.href = Couriers.trackUrl(b.courier, b.tracking); a.target = '_blank'; a.rel = 'noopener';
      a.textContent = Couriers.name(b.courier) + ' · ' + b.tracking; tr.appendChild(a);
      var st = div('stg-track-st' + (/cancel|return|fail/i.test(b.ishipCode || '') ? ' bad' : ''));
      st.textContent = (b.ishipStatus || 'รอเข้ารับพัสดุ') + (b.ishipStatusAt ? ' · ' + when(b.ishipStatusAt) : '');
      tr.appendChild(st);
      card.appendChild(tr);
      itemList(card, x.items);
      var act = div('stg-actions');
      [['&#x1F5A8; ใบปะหน้า A6', function() { openIshipLabel(b.tracking); }],
       ['&#x1F4CD; เช็คสถานะ', function() { openIshipTrace(b.tracking, b.courier, renderStatusPanel); }]].forEach(function(p) {
        var bt = makeBtn('btn btn-ghost btn-sm', p[0], p[1]); bt.type = 'button'; act.appendChild(bt);
      });
      card.appendChild(act);
      grid.appendChild(card);
    });
    body.appendChild(grid); more(bills.length);
  }
  // Asks iShip for each parcel's latest step (saved by the function), then reloads
  function refreshAll(bills, btn) {
    btn.disabled = true;
    var i = 0;
    (function next() {
      if (i >= bills.length) { toast('อัปเดตสถานะพัสดุแล้ว', 'success'); renderStatusPanel(); return; }
      btn.textContent = '🔄 กำลังเช็ค ' + (i + 1) + '/' + bills.length;
      apiCall('adminIship', 'trace', { tracking: bills[i++].b.tracking }).then(next);
    })();
  }

  // ── 5. Delivered, shipped outside iShip, or cancelled ──
  function drawDone() {
    var gs = checkouts(S.done.filter(hit));
    if (!gs.length) return empty(STAGES[4].empty);
    var grid = div('stg-grid');
    gs.slice(0, STAGE_CAP).forEach(function(g) { grid.appendChild(orderCard(g)); });
    body.appendChild(grid); more(gs.length);
  }

  function markPaid(items) {
    askConfirm('ยังไม่ได้รับสลิปของ ' + custName(items) + ' — ถือว่าชำระแล้ว และย้ายไปขั้น "ถึงไทย / ส่งบิล"?', 'ชำระแล้ว').then(function(ok) {
      if (!ok) return;
      body.classList.add('busy');
      apiCall('adminSetOrderStatus', ids(items), PAID_LABEL, '').then(function(res) {
        body.classList.remove('busy');
        if (res.status !== 'Success') { toast(res.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
        items.forEach(function(o) { o.status = res.orderStatus || PAID_LABEL; });
        toast('ย้ายไปขั้น "ถึงไทย / ส่งบิล" แล้ว', 'success');
        drawStages();
      });
    });
  }

  function markArrived(items, msg) {
    var need = items.filter(function(o) { return !o.shippedAt && !ARRIVED_RE.test(o.status || ''); });
    if (!need.length) { drawStages(); return Promise.resolve(); }
    body.classList.add('busy');
    return apiCall('adminSetOrderStatus', ids(need), ARRIVED_LABEL, '').then(function(res) {
      body.classList.remove('busy');
      if (res.status !== 'Success') { toast(res.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
      need.forEach(function(o) { o.status = res.orderStatus || ARRIVED_LABEL; });
      if (msg) toast(msg, 'success');
      drawStages();
    });
  }

  function sendBill(b, send) {
    if (send) { sendBillNow(b, true); return; }
    askConfirm('ถอนบิลนี้กลับเป็นร่าง? ลูกค้าจะไม่เห็นบิลจนกว่าจะส่งใหม่', 'ถอนบิล').then(function(ok) {
      if (ok) sendBillNow(b, false);
    });
  }
  function sendBillNow(b, send) {
    body.classList.add('busy');
    apiCall('adminSendDelivery', b.id, send).then(function(res) {
      body.classList.remove('busy');
      if (res.status !== 'Success') { toast(res.message || 'ส่งบิลไม่สำเร็จ', 'error'); return; }
      b.sentAt = res.sentAt || '';
      toast(send ? 'ส่งบิลแล้ว — รอลูกค้าโอน แล้วบิลจะย้ายไปแท็บ "รอจัดส่ง"' : 'ถอนบิลแล้ว — กลับเป็นบิลร่าง', 'success');
      drawStages();
    });
  }

  function setBill(orderIds, deliveryId, isNew, cust) {
    if (!orderIds.length) return;
    var leavingPaid = B.orders.some(function(o) {
      return orderIds.indexOf(o.id) !== -1 && o.deliveryId && o.deliveryId !== deliveryId &&
        B.payments.some(function(p) { return p.deliveryId === o.deliveryId; });
    });
    if (!leavingPaid) { setBillNow(orderIds, deliveryId, isNew, cust); return; }
    askConfirm('ลูกค้าโอนค่าบิลเดิมของสินค้านี้แล้ว — ย้ายออกจากบิลนั้นจริงไหม?', 'ย้าย').then(function(ok) {
      if (ok) setBillNow(orderIds, deliveryId, isNew, cust);
    });
  }
  function setBillNow(orderIds, deliveryId, isNew, cust) {
    body.classList.add('busy');
    apiCall('adminSetDelivery', orderIds, deliveryId, isNew).then(function(res) {
      body.classList.remove('busy');
      if (res.status !== 'Success') { toast(res.message || 'ย้ายไม่สำเร็จ', 'error'); return; }
      var target = res.deliveryId || '';
      if (isNew && target) {
        var nb = { id: target, customer: cust, fee: null, createdAt: new Date().toISOString(), sentAt: '' };
        B.deliveries.push(nb);
        // New bills start with the default fee from ⚙️ ตั้งค่าบิล (still editable on the draft)
        if (_billSet.fee !== null) apiCall('adminSetDeliveryFee', target, _billSet.fee).then(function(f) {
          if (f.status === 'Success') { nb.fee = f.fee; drawStages(); }
        });
      }
      var moved = B.orders.filter(function(o) { return orderIds.indexOf(o.id) !== -1; });
      moved.forEach(function(o) { o.deliveryId = target; });
      // Mirror the database: bills with no items and no payments are gone
      B.deliveries = B.deliveries.filter(function(b) {
        return B.orders.some(function(o) { return o.deliveryId === b.id; }) || B.payments.some(function(p) { return p.deliveryId === b.id; });
      });
      toast(isNew ? 'สร้างบิลแล้ว' : target ? 'รวมเข้าบิลแล้ว' : 'นำออกจากบิลแล้ว', 'success');
      // Billing an order that hadn't been marked yet means it has arrived
      if (target) markArrived(moved); else drawStages();
    });
  }

  function draw() {
    body.innerHTML = '';
    ({ pay: drawPay, arrive: drawArrive, ship: drawShip, track: drawTrack, done: drawDone })[_stm.stage]();
  }
  draw();
}

function dragSource(node, getData) {
  node.draggable = true;
  node.addEventListener('dragstart', function(e) {
    e.stopPropagation(); // an item inside an order drags on its own
    _billDrag = getData();
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', 'bill'); } catch (x) {}
    node.classList.add('dragging');
  });
  node.addEventListener('dragend', function() {
    node.classList.remove('dragging'); _billDrag = null;
    document.querySelectorAll('.drop-on').forEach(function(n) { n.classList.remove('drop-on'); });
  });
}
function dropZone(node, onDrop) {
  node.addEventListener('dragover', function(e) {
    if (!_billDrag) return;
    e.preventDefault(); e.stopPropagation();
    document.querySelectorAll('.drop-on').forEach(function(n) { if (n !== node) n.classList.remove('drop-on'); });
    node.classList.add('drop-on');
  });
  node.addEventListener('dragleave', function(e) { if (!node.contains(e.relatedTarget)) node.classList.remove('drop-on'); });
  node.addEventListener('drop', function(e) {
    e.preventDefault(); e.stopPropagation();
    node.classList.remove('drop-on');
    var d = _billDrag; _billDrag = null;
    if (d) onDrop(d);
  });
}

// Promise wrapper for a google.script.run call; resolves to the parsed result
function apiCall(fn) {
  var args = Array.prototype.slice.call(arguments, 1);
  return new Promise(function(resolve) {
    var run = google.script.run.withSuccessHandler(function(r) {
      var res; try { res = JSON.parse(r); } catch (e) { res = { status: 'Error', message: 'เกิดข้อผิดพลาด' }; }
      resolve(res);
    }).withFailureHandler(function(e) { resolve({ status: 'Error', message: (e && e.message) || 'เชื่อมต่อไม่ได้' }); });
    run[fn].apply(run, args);
  });
}

// ════════════════════════════════
// REORDER — drag a row/card by its ⠿ handle onto another to take its place,
// or use ▲▼ (touch screens). save(newKeys) gets every key in the new order.
// ════════════════════════════════
function enableReorder(nodes, keys, save, hostOf) {
  var group = 'r' + Math.random().toString(36).slice(2);
  Array.prototype.forEach.call(nodes, function(node, i) {
    node.classList.add('reorder-item');
    dragSource(node, function() { return { reorder: group, from: i }; });
    node.draggable = false; // only the handle starts a drag, so inputs inside stay usable
    dropZone(node, function(d) {
      if (d.reorder !== group || d.from === i) return;
      var order = keys.slice(); order.splice(i, 0, order.splice(d.from, 1)[0]);
      save(order);
    });
    var host = hostOf(node);
    var handle = document.createElement('span'); handle.className = 'reorder-handle mouse-only';
    handle.textContent = '⠿'; handle.title = 'ลากเพื่อจัดลำดับ'; handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('mousedown', function() { node.draggable = true; });
    node.addEventListener('dragend', function() { node.draggable = false; });
    host.appendChild(handle);
    [[-1, '▲', 'เลื่อนขึ้น'], [1, '▼', 'เลื่อนลง']].forEach(function(a) {
      var b = makeBtn('reorder-btn touch-only', a[1], function(e) {
        e.stopPropagation();
        var j = i + a[0];
        var order = keys.slice(); order.splice(j, 0, order.splice(i, 1)[0]);
        save(order);
      });
      b.type = 'button'; b.title = a[2]; b.setAttribute('aria-label', a[2]);
      b.disabled = i + a[0] < 0 || i + a[0] >= keys.length;
      host.appendChild(b);
    });
  });
}

// A press on a handle that didn't become a drag must not leave the row draggable
document.addEventListener('mouseup', function() {
  document.querySelectorAll('.reorder-item[draggable=true]').forEach(function(n) { n.draggable = false; });
});

// ════════════════════════════════
// SLIP MATCHING — drag a slip (or pick it with "ย้าย") onto one of the
// customer's order lists or delivery bills to re-file it there.
// ════════════════════════════════
var _slipTargets = null; // { orders, deliveries } loaded on first use
function loadSlipTargets(cb) {
  if (_slipTargets) { cb(); return; }
  Promise.all([apiCall('adminGetAllOrders'), apiCall('adminGetDeliveries')]).then(function(r) {
    if (r[0].status !== 'Success') { toast(r[0].message || 'โหลดคำสั่งซื้อไม่สำเร็จ', 'error'); return; }
    _slipTargets = { orders: (r[0].orders || []).filter(function(o) { return o.remark !== 'POS'; }), deliveries: r[1].deliveries || [] };
    cb();
  });
}

function drawSlipTargets(panel, ctx) {
  panel.innerHTML = '';
  var head = div('slip-targets-head');
  head.appendChild(div('bill-col-title', '🎯 ย้ายสลิปไปที่'));
  if (ctx.close) {
    var x = makeBtn('btn btn-ghost btn-sm', '&#x2715;', ctx.close);
    x.type = 'button'; x.title = 'ปิด'; x.setAttribute('aria-label', 'ปิดแผงย้ายสลิป'); head.appendChild(x);
  }
  panel.appendChild(head);
  var sw = div('search-row'); sw.innerHTML = SVG_SEARCH;
  var si = document.createElement('input'); si.placeholder = 'ชื่อลูกค้า (@)'; si.value = ctx.who || '';
  sw.appendChild(si); panel.appendChild(sw);
  var box = div('slip-target-list'); panel.appendChild(box);
  var p = ctx.picked;
  panel.appendChild(div('slip-meta', p
    ? 'สลิปที่เลือก: ' + escapeHtml(p.customer) + ' · ' + escapeHtml(baht(p.amount)) + ' — ลากสลิปมาวาง หรือแตะปลายทาง'
    : 'ลากสลิปจากรายการทางซ้ายมาวางบนรายการ/บิลของลูกค้า หรือกด "ย้าย" ที่สลิป'));
  si.oninput = function() { ctx.who = si.value; fill(); };

  function fill() {
    box.innerHTML = '';
    var who = normCust(si.value);
    if (who.length < 2) { box.appendChild(div('state-empty', 'พิมพ์ชื่อลูกค้า หรือเลือกสลิป')); return; }
    if (!_slipTargets) { box.appendChild(makeSpinner()); loadSlipTargets(fill); return; }
    var mine = _slipTargets.orders.filter(function(o) { return normCust(o.customer) === who; });
    if (!mine.length) { box.appendChild(div('state-empty', 'ไม่พบคำสั่งซื้อของ @' + escapeHtml(who))); return; }
    var raw = mine[0].customer;
    var lists = [], byList = {};
    mine.forEach(function(o) {
      if (!byList[o.listId]) { byList[o.listId] = { id: o.listId, name: o.shopName, items: [] }; lists.push(byList[o.listId]); }
      byList[o.listId].items.push(o);
    });
    lists.forEach(function(l) {
      var dep = l.items.some(function(o) { return o.payType === 'Deposit'; });
      var t = target('📋 ' + (l.name || 'รายการสั่งซื้อ'), l.items.length + ' รายการ · ' + (dep ? 'มัดจำ' : 'จ่ายเต็ม'),
        p && p.listId === l.id && !p.deliveryId);
      hook(t, { listId: l.id, deliveryId: '', customer: raw, label: l.name });
    });
    _slipTargets.deliveries.filter(function(b) { return b.customer === who; }).forEach(function(b, i) {
      var items = mine.filter(function(o) { return o.deliveryId === b.id; });
      if (!items.length) return;
      var t = target('🧾 บิล ' + (i + 1) + ' · ส่วนที่เหลือ + ค่าส่ง', items.length + ' รายการ' + (b.sentAt ? ' · ส่งบิลแล้ว' : ' · ร่าง'), p && p.deliveryId === b.id);
      hook(t, { listId: '', deliveryId: b.id, customer: raw, label: 'บิล ' + (i + 1) });
    });
  }
  function target(title, sub, current) {
    var t = document.createElement('button'); t.type = 'button'; t.className = 'slip-target' + (current ? ' current' : '');
    var a = document.createElement('strong'); a.textContent = title; t.appendChild(a);
    var b = document.createElement('span'); b.textContent = current ? sub + ' · อยู่ที่นี่' : sub; t.appendChild(b);
    box.appendChild(t);
    return t;
  }
  function hook(t, dest) {
    t.onclick = function() { if (ctx.picked) link(ctx.picked, dest); else toast('เลือกสลิปก่อน (กด "ย้าย" ที่สลิป)', 'error'); };
    dropZone(t, function(d) { if (d.slip) link(d.slip, dest); });
  }
  function link(pay, dest) {
    var sameCust = normCust(pay.customer) === normCust(dest.customer);
    if (sameCust && (dest.deliveryId ? pay.deliveryId === dest.deliveryId : pay.listId === dest.listId && !pay.deliveryId)) return;
    if (sameCust) { linkNow(pay, dest); return; }
    askConfirm('ย้ายสลิปของ ' + pay.customer + ' ไปเป็นของ ' + dest.customer + '?', 'ย้ายสลิป').then(function(ok) {
      if (ok) linkNow(pay, dest);
    });
  }
  function linkNow(pay, dest) {
    apiCall('adminLinkPayment', pay.id, dest.listId, dest.deliveryId, dest.customer).then(function(res) {
      if (res.status !== 'Success') { toast(res.message || 'ย้ายสลิปไม่สำเร็จ', 'error'); return; }
      pay.listId = res.listId; pay.deliveryId = res.deliveryId; pay.kind = res.kind; pay.customer = res.customer;
      toast('ย้ายสลิปไปที่ ' + (dest.label || 'ปลายทาง') + ' แล้ว', 'success');
      ctx.onChange();
    });
  }
  fill();
}

// ════════════════════════════════
// IMAGE DROP — drop an image file on any photo picker to upload it, as if
// it had been chosen with the file dialog.
// ════════════════════════════════
function imageDropInput(node) {
  for (var depth = 0; node && node !== document.body && depth < 6; depth++, node = node.parentElement) {
    var inp = node.querySelector && node.querySelector(':scope > input[type=file][accept^="image"]:not([capture]), :scope > * > input[type=file][accept^="image"]:not([capture])');
    if (inp) return { zone: node, input: inp };
  }
  return null;
}
(function() {
  var lit = null;
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') !== -1; }
  function light(z) { if (lit && lit !== z) lit.classList.remove('img-drop-on'); lit = z; if (z) z.classList.add('img-drop-on'); }
  document.addEventListener('dragover', function(e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); // also stops the browser opening a stray dropped file
    var t = imageDropInput(e.target);
    e.dataTransfer.dropEffect = t ? 'copy' : 'none';
    light(t ? t.zone : null);
  });
  document.addEventListener('dragleave', function(e) { if (!e.relatedTarget) light(null); });
  document.addEventListener('drop', function(e) {
    if (!hasFiles(e)) return;
    e.preventDefault(); light(null);
    var t = imageDropInput(e.target);
    if (!t) return;
    var files = Array.prototype.filter.call(e.dataTransfer.files, function(f) { return /^image\//.test(f.type); });
    if (!files.length) { toast('วางได้เฉพาะไฟล์รูปภาพ', 'error'); return; }
    var dt = new DataTransfer();
    (t.input.multiple ? files : files.slice(0, 1)).forEach(function(f) { dt.items.add(f); });
    t.input.files = dt.files;
    t.input.dispatchEvent(new Event('change', { bubbles: true }));
  });
})();

// ════════════════════════════════
// iSHIP — book a delivery bill with iShip (tracking number + label), track
// parcels, call a courier for pickup. Calls go through the "iship" Edge
// Function; the sender address lives in app_settings ('iship').
// ════════════════════════════════
var ISHIP_CATEGORIES = [[99, 'อื่นๆ'], [0, 'เอกสาร'], [1, 'อาหารแห้ง'], [2, 'ของใช้'], [3, 'อุปกรณ์ไอที'], [4, 'เสื้อผ้า'],
  [5, 'สื่อบันเทิง'], [6, 'อะไหล่รถยนต์'], [7, 'รองเท้า/กระเป๋า'], [8, 'อุปกรณ์กีฬา'], [9, 'เครื่องสำอางค์'], [10, 'เฟอร์นิเจอร์'], [11, 'ผลไม้']];

// Name / phone / address + subdistrict, district, province, postcode with
// autocomplete, and a "paste the whole address" helper. get() → parts.
function makeAddressFields(parts, idPrefix, nameLabel) {
  parts = parts || {};
  var wrap = div('addr-fields');
  var paste = div('addr-paste');
  var pt = document.createElement('textarea'); pt.rows = 2; pt.placeholder = 'วางที่อยู่ทั้งหมดที่นี่ แล้วกด "แยกที่อยู่" (ชื่อ เบอร์ บ้านเลขที่ ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)';
  pt.setAttribute('aria-label', 'วางที่อยู่ทั้งหมด');
  var pb = makeBtn('btn btn-ghost btn-sm', 'แยกที่อยู่', function() {
    ThaiAddress.load().then(function() {
      var p = ThaiAddress.parse(pt.value);
      Object.keys(p).forEach(function(k) { if (p[k] && inputs[k]) inputs[k].value = p[k]; });
      toast(p.district ? 'แยกที่อยู่แล้ว ตรวจสอบอีกครั้ง' : 'หาตำบล/อำเภอไม่เจอ กรุณาเลือกเอง', p.district ? 'success' : 'error');
    }, function() { toast('โหลดข้อมูลที่อยู่ไม่สำเร็จ', 'error'); });
  });
  pb.type = 'button';
  paste.appendChild(pt); paste.appendChild(pb); wrap.appendChild(paste);
  var grid = div('addr-grid');
  var inputs = {};
  [['name', nameLabel || 'ชื่อผู้รับ', 'full'], ['phone', 'เบอร์โทร', ''], ['zipcode', 'รหัสไปรษณีย์', ''], ['address', 'บ้านเลขที่ / หมู่ / ซอย / ถนน', 'full'],
   ['district', 'ตำบล / แขวง', ''], ['amphoe', 'อำเภอ / เขต', ''], ['province', 'จังหวัด', 'full']].forEach(function(f) {
    var lab = document.createElement('label'); lab.className = 'addr-field' + (f[2] ? ' ' + f[2] : '');
    var sp = document.createElement('span'); sp.textContent = f[1]; lab.appendChild(sp);
    var inp = document.createElement('input'); inp.value = parts[f[0]] || ''; inp.id = (idPrefix || 'ad') + '-' + f[0];
    if (f[0] === 'phone') { inp.inputMode = 'tel'; inp.maxLength = 12; }
    if (f[0] === 'zipcode') { inp.inputMode = 'numeric'; inp.maxLength = 5; }
    lab.appendChild(inp); grid.appendChild(lab); inputs[f[0]] = inp;
  });
  wrap.appendChild(grid);
  wrap.appendChild(div('slip-meta', 'พิมพ์ตำบล อำเภอ หรือรหัสไปรษณีย์ แล้วเลือกจากรายการ — ข้อมูลจะเติมให้ครบ'));
  ThaiAddress.attach({ district: inputs.district, amphoe: inputs.amphoe, province: inputs.province, zipcode: inputs.zipcode });
  return {
    node: wrap,
    get: function() { var o = {}; Object.keys(inputs).forEach(function(k) { o[k] = inputs[k].value.trim(); }); return o; },
    set: function(p) { Object.keys(inputs).forEach(function(k) { inputs[k].value = (p && p[k]) || ''; }); }
  };
}
function addressProblem(p) {
  var miss = ['name', 'phone', 'address', 'district', 'amphoe', 'province', 'zipcode'].filter(function(k) { return !p[k]; });
  if (miss.length) return 'กรุณากรอกที่อยู่ให้ครบ';
  if (!/^0\d{8,9}$/.test(p.phone.replace(/[\s-]/g, ''))) return 'เบอร์โทรไม่ถูกต้อง';
  if (!ThaiAddress.valid(p)) return 'ตำบล / อำเภอ / จังหวัด / รหัสไปรษณีย์ไม่ตรงกัน — กรุณาเลือกจากรายการ';
  return '';
}

function openIshipSettings() {
  apiCall('adminGetSetting', 'iship').then(function(res) {
    if (res.status !== 'Success') { toast(res.message || 'โหลดการตั้งค่าไม่สำเร็จ', 'error'); return; }
    var v = res.value || {};
    el('modalBody').innerHTML = '';
    el('modalBody').appendChild(div('iship-sec', '1. ที่อยู่ผู้ส่ง <small>พิมพ์บนใบปะหน้าทุกกล่อง</small>'));
    var addr = makeAddressFields(v, 'isf', 'ชื่อผู้ส่ง / ชื่อร้าน');
    el('modalBody').appendChild(addr.node);
    // Parcel defaults: iShip needs a category and size to price a parcel; each booking can change them
    el('modalBody').appendChild(div('iship-sec', '2. ค่าเริ่มต้นของพัสดุ <small>ขนส่งใช้คิดราคา · ปรับได้ทุกครั้งตอนกดจัดส่ง</small>'));
    var cf = div('modal-field'); var cl = document.createElement('label'); cl.htmlFor = 'isfCat'; cl.textContent = 'ประเภทสินค้า (แจ้งขนส่ง)'; cf.appendChild(cl);
    var cat = document.createElement('select'); cat.id = 'isfCat';
    ISHIP_CATEGORIES.forEach(function(c) { var o = document.createElement('option'); o.value = c[0]; o.textContent = c[1]; cat.appendChild(o); });
    cat.value = v.category_id === undefined ? 99 : v.category_id; cf.appendChild(cat); el('modalBody').appendChild(cf);
    var parcel = makeParcelInputs(v);
    el('modalBody').appendChild(parcel.node);
    openModal('&#x2699;&#xFE0F; ตั้งค่าผู้ส่ง iShip', '', function() {
      var p = addr.get();
      var bad = addressProblem(p);
      if (bad) { toast(bad, 'error'); return; }
      var value = Object.assign(p, { category_id: Number(cat.value) }, parcel.get());
      el('modalSave').disabled = true;
      apiCall('adminSaveSetting', 'iship', value).then(function(r) {
        el('modalSave').disabled = false;
        if (r.status !== 'Success') { toast(r.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
        closeModal(); toast('บันทึกการตั้งค่าผู้ส่งแล้ว', 'success');
      });
    }, 'บันทึก');
  });
}

function makeParcelInputs(v) {
  var f = div('modal-field');
  var l = document.createElement('label'); l.textContent = 'พัสดุ: น้ำหนัก (กก.) · กว้าง × ยาว × สูง (ซม.)'; f.appendChild(l);
  var row = div('parcel-row'), ins = {};
  [['weight', 'กก.', 1, '0.1'], ['width', 'กว้าง', 10, '1'], ['length', 'ยาว', 15, '1'], ['height', 'สูง', 5, '1']].forEach(function(d) {
    var i = document.createElement('input'); i.type = 'number'; i.min = '0'; i.step = d[3]; i.inputMode = 'decimal';
    i.value = v[d[0]] || d[2]; i.setAttribute('aria-label', d[1]); i.title = d[1];
    row.appendChild(i); ins[d[0]] = i;
  });
  f.appendChild(row);
  return { node: f, row: row, get: function() { var o = {}; Object.keys(ins).forEach(function(k) { o[k] = Number(ins[k].value) || 0; }); return o; } };
}

// Book one delivery bill: recipient, parcel size, courier prices → tracking number
function openIshipModal(b, x, after) {
  var who = x.items.length ? x.items[0].customer : '@' + b.customer;
  el('modalBody').innerHTML = '';
  var toBox = div('iship-to'); toBox.textContent = 'กำลังโหลดที่อยู่ผู้รับและราคาขนส่ง...';
  el('modalBody').appendChild(toBox);
  var editWrap = div(''); editWrap.hidden = true; el('modalBody').appendChild(editWrap);
  var addr = null;
  function editAddress(prefill) {
    if (!addr) { addr = makeAddressFields(prefill || {}, 'ism'); editWrap.appendChild(addr.node); }
    editWrap.hidden = false;
  }
  var parcel = makeParcelInputs({});
  var qBtn = makeBtn('btn btn-ghost btn-sm', 'เช็คราคา', function() { quote(); }); qBtn.type = 'button';
  parcel.row.appendChild(qBtn);
  el('modalBody').appendChild(parcel.node);
  var prices = div('iship-prices'); el('modalBody').appendChild(prices);
  var rf = div('modal-field'); var rl = document.createElement('label'); rl.htmlFor = 'ismRemark'; rl.textContent = 'หมายเหตุถึงขนส่ง (ไม่บังคับ)'; rf.appendChild(rl);
  var remark = document.createElement('input'); remark.id = 'ismRemark'; remark.maxLength = 200; remark.placeholder = 'เช่น ห้ามโยน'; rf.appendChild(remark);
  el('modalBody').appendChild(rf);
  var chosen = null;
  var manual = makeBtn('btn btn-ghost btn-sm iship-manual', 'ส่งเองโดยไม่ใช้ iShip (กรอกเลขพัสดุเอง)', function() {
    var waiting = x.items.filter(isWaiting);
    if (!waiting.length) { toast('ไม่มีสินค้าที่รอจัดส่งในบิลนี้', 'error'); return; }
    openStatusModal(waiting, { preset: 'shipped', after: after });
  });
  manual.type = 'button'; el('modalBody').appendChild(manual);
  openModal('&#x1F69A; ส่งด้วย iShip · ' + escapeHtml(who), '', save, 'สร้างเลขพัสดุ');
  el('modalSave').disabled = true;

  apiCall('adminGetSetting', 'iship').then(function(res) {
    var v = (res && res.value) || {};
    var p = makeParcelInputs(v).get(); // defaults from settings
    parcel.row.querySelectorAll('input').forEach(function(i, k) { i.value = p[['weight', 'width', 'length', 'height'][k]]; });
    quote();
  });

  function quote() {
    var to = addr && !editWrap.hidden ? addr.get() : undefined;
    if (to) { var bad = addressProblem(to); if (bad) { toast(bad, 'error'); return; } }
    prices.innerHTML = ''; prices.appendChild(makeSpinner());
    chosen = null; el('modalSave').disabled = true;
    apiCall('adminIship', 'quote', { deliveryId: b.id, parcel: parcel.get(), to: to }).then(function(res) {
      prices.innerHTML = '';
      if (res.status !== 'Success') {
        var msg = res.message || 'เช็คราคาไม่สำเร็จ';
        toBox.textContent = '⚠️ ' + msg;
        if (/ผู้ส่ง/.test(msg)) {
          var go = makeBtn('btn btn-ghost btn-sm', '&#x2699;&#xFE0F; ตั้งค่าผู้ส่ง', openIshipSettings); go.type = 'button'; toBox.appendChild(go);
        } else if (/ผู้รับ/.test(msg)) {
          // No structured address yet: start from the text address the customer sent
          var text = (x.pays.filter(function(p) { return p.address; })[0] || {}).address || '';
          ThaiAddress.load().then(function() { editAddress(text ? ThaiAddress.parse(text) : {}); }, function() { editAddress({}); });
          toBox.textContent = 'ลูกค้ายังไม่ได้กรอกที่อยู่แบบแยกช่อง — ตรวจสอบ/กรอกด้านล่างแล้วกด "เช็คราคา"';
        }
        return;
      }
      var t = res.to || {};
      toBox.innerHTML = '';
      var h = document.createElement('strong'); h.textContent = 'ผู้รับ: ' + (t.name || '') + ' · ' + (t.phone || ''); toBox.appendChild(h);
      var a = div('slip-meta'); a.textContent = [t.address, 'ต.' + t.district, 'อ.' + t.amphoe, 'จ.' + t.province, t.zipcode].join(' '); toBox.appendChild(a);
      if (editWrap.hidden) {
        var ed = makeBtn('btn btn-ghost btn-sm', 'แก้ที่อยู่ผู้รับ', function() { editAddress(t); ed.remove(); }); ed.type = 'button'; toBox.appendChild(ed);
      }
      (res.prices || []).forEach(function(c, i) {
        var row = document.createElement('label'); row.className = 'iship-price' + (c.price == null ? ' off' : '');
        var r = document.createElement('input'); r.type = 'radio'; r.name = 'ishipCourier'; r.value = c.code; r.disabled = c.price == null;
        r.onchange = function() { chosen = c; el('modalSave').disabled = false; el('modalSave').textContent = 'สร้างเลขพัสดุ · ' + baht(c.price); };
        row.appendChild(r);
        var nm = document.createElement('span'); nm.className = 'iship-cname'; nm.textContent = c.name; row.appendChild(nm);
        var pr = document.createElement('span'); pr.className = 'iship-cprice';
        pr.textContent = c.price == null ? (c.error || 'ใช้ไม่ได้') : baht(c.price) + (c.remote ? ' (พื้นที่ห่างไกล +' + baht(c.remote) + ')' : '');
        row.appendChild(pr);
        prices.appendChild(row);
        if (i === 0 && c.price != null) { r.checked = true; r.onchange(); }
      });
      if (!(res.prices || []).length) prices.appendChild(div('state-empty', 'ไม่มีขนส่งให้เลือก'));
    });
  }

  function save() {
    if (!chosen) { toast('กรุณาเลือกขนส่ง', 'error'); return; }
    var to = addr && !editWrap.hidden ? addr.get() : undefined;
    if (to) { var bad = addressProblem(to); if (bad) { toast(bad, 'error'); return; } }
    askConfirm('สร้างเลขพัสดุกับ ' + chosen.name + ' ราคา ' + baht(chosen.price) + '?\nระบบจะตัดเครดิต iShip ของร้าน', 'สร้างเลขพัสดุ').then(function(ok) {
      if (ok) create(to);
    });
  }
  function create(to) {
    el('modalSave').disabled = true; el('modalSave').textContent = 'กำลังสร้าง...';
    apiCall('adminIship', 'create', { deliveryId: b.id, courier: chosen.code, parcel: parcel.get(), remark: remark.value.trim(), to: to }).then(function(res) {
      if (res.status !== 'Success') {
        el('modalSave').disabled = false; el('modalSave').textContent = 'สร้างเลขพัสดุ · ' + baht(chosen.price);
        toast(res.message || 'สร้างเลขพัสดุไม่สำเร็จ', 'error'); return;
      }
      b.tracking = res.tracking; b.courier = res.courier; b.ishipStatus = 'รอเข้ารับพัสดุ'; b.ishipCode = 'order_success';
      x.items.forEach(function(o) {
        if ((res.shipped || []).indexOf(o.id) !== -1) { o.shippedAt = res.shippedAt; o.tracking = res.tracking; o.courier = res.courier; o.status = ''; }
      });
      Couriers.learn([{ code: chosen.code, name: chosen.name }]);
      closeModal();
      toast('สร้างเลขพัสดุแล้ว ' + res.tracking + ' — กด 🖨 เพื่อพิมพ์ใบปะหน้า', 'success');
      if (after) after();
    });
  }
}

// Label PDF in a new tab (opened now so the pop-up blocker allows it)
function openIshipLabel(tracking) {
  var w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:sans-serif">กำลังโหลดใบปะหน้า...</p>');
  apiCall('adminIshipLabel', tracking).then(function(res) {
    if (res.status !== 'Success') { if (w) w.close(); toast(res.message || 'โหลดใบปะหน้าไม่สำเร็จ', 'error'); return; }
    if (w) w.location = res.url; else window.open(res.url, '_blank');
  });
}

function openIshipTrace(tracking, courier, onUpdated) {
  el('modalBody').innerHTML = '';
  var box = div('trace-list'); box.appendChild(makeSpinner()); el('modalBody').appendChild(box);
  var link = Couriers.trackUrl(courier, tracking);
  if (link) {
    var a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.className = 'slip-meta';
    a.textContent = 'เปิดหน้าติดตามของขนส่ง ↗'; el('modalBody').appendChild(a);
  }
  openModal('&#x1F4CD; ติดตามพัสดุ · ' + escapeHtml(tracking), '', null);
  apiCall('adminIship', 'trace', { tracking: tracking }).then(function(res) {
    box.innerHTML = '';
    if (res.status !== 'Success') { box.appendChild(div('state-empty', escapeHtml(res.message || 'โหลดไม่สำเร็จ'))); return; }
    if (onUpdated && (res.trace_routes || []).length) onUpdated();
    var routes = (res.trace_routes || []).slice().reverse();
    if (!routes.length) { box.appendChild(div('state-empty', 'ยังไม่มีความเคลื่อนไหว')); return; }
    routes.forEach(function(r, i) {
      var it = div('trace-item' + (i === 0 ? ' now' : ''));
      var t = document.createElement('strong'); t.textContent = r.status_text || r.status || ''; it.appendChild(t);
      var d = div('slip-meta'); d.textContent = (r.status_desc || '') + (r.current_location ? ' · ' + r.current_location : ''); it.appendChild(d);
      var ts = div('slip-meta'); ts.textContent = r.timestamp || ''; it.appendChild(ts);
      box.appendChild(it);
    });
  });
}

function openPickupModal() {
  el('modalBody').innerHTML = '';
  var cf = div('modal-field'); var cl = document.createElement('label'); cl.htmlFor = 'pkCourier'; cl.textContent = 'ขนส่ง'; cf.appendChild(cl);
  var sel = document.createElement('select'); sel.id = 'pkCourier'; cf.appendChild(sel); el('modalBody').appendChild(cf);
  var nf = div('modal-field'); var nl = document.createElement('label'); nl.htmlFor = 'pkCount'; nl.textContent = 'จำนวนพัสดุ'; nf.appendChild(nl);
  var cnt = document.createElement('input'); cnt.id = 'pkCount'; cnt.type = 'number'; cnt.min = '1'; cnt.value = '1'; nf.appendChild(cnt); el('modalBody').appendChild(nf);
  var rf = div('modal-field'); var rl = document.createElement('label'); rl.htmlFor = 'pkRemark'; rl.textContent = 'หมายเหตุ (ไม่บังคับ)'; rf.appendChild(rl);
  var rem = document.createElement('input'); rem.id = 'pkRemark'; rem.maxLength = 200; rf.appendChild(rem); el('modalBody').appendChild(rf);
  el('modalBody').appendChild(div('slip-meta', 'ขนส่งจะเข้ารับที่อยู่ผู้ส่งในการตั้งค่า iShip'));
  function fill(list) {
    sel.innerHTML = '';
    list.forEach(function(c) { var o = document.createElement('option'); o.value = c.code; o.textContent = c.name; sel.appendChild(o); });
  }
  fill(Couriers.list.filter(function(c) { return c.code !== 'Other'; }));
  apiCall('adminIship', 'couriers').then(function(res) {
    if (res.status === 'Success' && (res.couriers || []).length) { Couriers.learn(res.couriers); fill(res.couriers); }
  });
  openModal('&#x1F69A; เรียกรถเข้ารับพัสดุ', '', function() {
    el('modalSave').disabled = true;
    apiCall('adminIship', 'pickup', { courier: sel.value, parcels: Number(cnt.value) || 1, remark: rem.value.trim() }).then(function(res) {
      el('modalSave').disabled = false;
      if (res.status !== 'Success') { toast(res.message || 'เรียกรถไม่สำเร็จ', 'error'); return; }
      closeModal(); toast(res.message || 'เรียกขนส่งเข้ารับแล้ว', 'success');
    });
  }, 'เรียกรถ');
}

// Pulls every tab of the old status sheet into the database, replacing
// what was imported before.
function openImportStatusSheet() {
  el('modalBody').innerHTML = '';
  var f = div('modal-field');
  var l = document.createElement('label'); l.htmlFor = 'stmSheetUrl'; l.textContent = 'ลิงก์ Google Sheet สถานะ'; f.appendChild(l);
  var inp = document.createElement('input'); inp.id = 'stmSheetUrl'; inp.placeholder = 'เว้นว่าง = ใช้ชีตสถานะเดิมของร้าน';
  f.appendChild(inp); el('modalBody').appendChild(f);
  el('modalBody').appendChild(div('slip-meta',
    'นำเข้าทุกแท็บ (หัวคอลัมน์ต้องมี "ชื่อแอคลูกค้า" และ "ชื่อสินค้า") ชีตต้องแชร์เป็น "ทุกคนที่มีลิงก์ดูได้"<br>' +
    '<strong style="color:var(--danger)">ข้อมูลที่นำเข้าก่อนหน้าจะถูกแทนที่ทั้งหมด</strong> รวมถึงสถานะที่แก้ในหน้านี้'));
  openModal('&#x1F4E5; นำเข้าชีตสถานะ', '', function() {
    var btn = el('modalSave'); btn.disabled = true; btn.textContent = 'กำลังนำเข้า...';
    google.script.run.withSuccessHandler(function(r) {
      btn.disabled = false; btn.textContent = 'นำเข้า';
      var res; try { res = JSON.parse(r); } catch (e) { res = {}; }
      if (res.status !== 'Success') { toast(res.message || 'นำเข้าไม่สำเร็จ', 'error'); return; }
      closeModal();
      toast('นำเข้าแล้ว ' + res.imported + ' รายการ จาก ' + res.tabs.length + ' แท็บ', 'success');
      _stm.legacy = null; _stm.legacyMissing = false; _stm.round = ''; _stm.cat = ''; _stm.q = '';
      renderHistoryPanel();
    }).withFailureHandler(function(e) {
      btn.disabled = false; btn.textContent = 'นำเข้า'; toast('นำเข้าไม่สำเร็จ: ' + (e && e.message || ''), 'error');
    }).adminImportStatusSheet(inp.value.trim());
  }, 'นำเข้า');
  el('modal').classList.add('open');
}

function confirmDeleteSelectedOrders() {
  var checked = document.querySelectorAll('#ordersDataTable .order-sel:checked');
  var rows = [];
  checked.forEach(function(cb) { rows.push(parseInt(cb.getAttribute('data-row'), 10)); });
  if (!rows.length) { toast('ยังไม่ได้เลือกคำสั่งซื้อ', 'error'); return; }
  var sheetId = selectedSheetId;
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x26A0;&#xFE0F;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">ลบคำสั่งซื้อที่เลือก ' + rows.length + ' รายการ?</div>' +
    '<div style="font-size:0.85rem;color:var(--text-2);">คำสั่งซื้อจะถูกลบออกถาวร (เหมาะสำหรับลบออเดอร์ทดสอบ)</div>' +
    '<div style="font-size:0.78rem;color:var(--danger);margin-top:6px;">สต็อกที่ถูกตัดไปจากคำสั่งซื้อเหล่านี้จะไม่ถูกคืนอัตโนมัติ — ถ้าต้องการคืน ให้แก้สต็อกในหน้าสินค้าเอง</div>';
  el('modalBody').appendChild(wrap);
  openModal('&#x1F5D1; ลบคำสั่งซื้อ', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังลบ...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          toast('ลบคำสั่งซื้อแล้ว ' + res.deleted + ' รายการ', 'success');
          loadOrders(sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false;
      toast('ลบคำสั่งซื้อไม่สำเร็จ', 'error');
    }).adminDeleteOrders(sheetId, rows);
  }, 'ลบ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

function filterOrderRows(term) {
  term = term.toLowerCase();
  var rows = document.querySelectorAll('#ordersDataTable .ocard, #ordersDataTable .isum-row');
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i].getAttribute('data-search') || '';
    rows[i].style.display = s.indexOf(term) !== -1 ? '' : 'none';
  }
}

function toMainSheetUrl(url) {
  if (!url) return '';
  return String(url).replace(/([?#].*)?$/, '') + '?gid=0#gid=0';
}

// ════════════════════════════════
// PRODUCTS
// ════════════════════════════════
function renderProductsPanel() {
  var visibleLists = getVisibleLists();

  // DEFAULT LOGIC: Force First Item (Since 'ALL' is invalid for products)
  if (!selectedSheetId || selectedSheetId === 'ALL' || !visibleLists.find(function(l){ return l.sheetId === selectedSheetId; })) {
    if (visibleLists.length > 0) {
      selectedSheetId = visibleLists[0].sheetId;
      selectedSheetName = visibleLists[0].name;
      currentProductsSheetId = selectedSheetId;
    } else {
      selectedSheetId = null; selectedSheetName = ''; currentProductsSheetId = null;
    }
  }

  setTopbar('สินค้า', selectedSheetName ? 'จาก: ' + selectedSheetName : 'เลือกรายการก่อน');
  var wrap = document.createElement('div');

  var pickerCard = div('section-card');
  pickerCard.appendChild(div('section-card-header', '<div class="section-card-title">&#x1F4E6; เลือกรายการสั่งซื้อ</div>'));
  
  var btnRow = document.createElement('div'); 
  btnRow.className = 'slider-wrap'; 

  // Use visibleLists instead of allLists
  for (var i = 0; i < visibleLists.length; i++) {
    var it = visibleLists[i];
    var btn = makeBtn(it.sheetId === selectedSheetId ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm', it.name, (function(item) {
      return function() { 
        selectedSheetId = item.sheetId; selectedSheetName = item.name; currentProductsSheetId = item.sheetId; 
        setTopbar('สินค้า', 'จาก: ' + item.name); renderProductsPanel(); 
      };
    })(it));
    btnRow.appendChild(btn);
  }
  pickerCard.appendChild(btnRow); wrap.appendChild(pickerCard);

  var prodHolder = document.createElement('div'); prodHolder.id = 'productsTable';
  if (!selectedSheetId) prodHolder.appendChild(div('state-empty', '&#x1F4CC; เลือกรายการด้านบนเพื่อดูสินค้า'));
  else prodHolder.appendChild(makeSpinner());
  
  wrap.appendChild(prodHolder); el('content').innerHTML = ''; el('content').appendChild(wrap);
  if (selectedSheetId) { currentProductsSheetId = selectedSheetId; loadProducts(selectedSheetId); }
}

function loadProducts(sheetId) {
  var holder = el('productsTable'); if (!holder) return;
  holder.innerHTML = ''; holder.appendChild(makeSpinner());
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') { holder.innerHTML = ''; holder.appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message))); return; }
      
      currentProductsCache = res.products; 
      renderProductsTable(currentProductsCache, sheetId, holder);
    } catch(e) { holder.innerHTML = ''; holder.appendChild(div('state-empty', 'เกิดข้อผิดพลาด')); }
  }).adminGetProducts(sheetId);
}

function setProductView(mode) {
  if (productViewMode === mode) return;
  productViewMode = mode;
  var holder = el('productsTable');
  if (holder && currentProductsCache.length > 0) {
    renderProductsTable(currentProductsCache, currentProductsSheetId, holder);
  }
}

var _prodSelected = {}; // rowIndex -> true (products panel multi-select)

function renderProductsTable(products, sheetId, holder) {
  currentProductsSheetId = sheetId;
  _changedStockRows = {};
  _prodSelected = {};
  holder.innerHTML = '';

  products = products.slice().sort(function(a, b) {
    if (a.status === 'Open' && b.status !== 'Open') return -1;
    if (a.status !== 'Open' && b.status === 'Open') return 1;
    return 0;
  });

  if (!products || !products.length) {
    var empty = div('state-empty', '&#x1F4ED; ยังไม่มีสินค้าค่ะ');
    var addBtn = makeBtn('btn btn-primary', '&#x1F4E6; นำเข้าจากคลัง', function() { switchPanel('stock'); });
    addBtn.style.marginTop = '12px'; empty.appendChild(addBtn); holder.appendChild(empty); return;
  }

  var card = div('section-card');
  var hdr = div('section-card-header');
  
  // Build the Header with Toggle Buttons
  var svgGrid = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
  var svgList = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
  hdr.appendChild(div('section-card-title', '&#x1F6CD;&#xFE0F; สินค้าทั้งหมด (' + products.length + ' รายการ)'));
  var hdrRight = document.createElement('div'); hdrRight.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';
  var vsw = div('view-switcher'); vsw.style.marginRight = '4px';
  var gBtn = makeBtn('view-btn' + (productViewMode === 'grid' ? ' active' : ''), svgGrid, function() { setProductView('grid'); }); gBtn.title = 'มุมมองกริด';
  var lBtn = makeBtn('view-btn' + (productViewMode === 'list' ? ' active' : ''), svgList, function() { setProductView('list'); }); lBtn.title = 'มุมมองรายการ';
  vsw.appendChild(gBtn); vsw.appendChild(lBtn); hdrRight.appendChild(vsw);
  // Products enter a list only from the warehouse (one place to add things)
  hdrRight.appendChild(makeBtn('btn btn-primary btn-sm', '&#x1F4E6; นำเข้าจากคลัง', function() { switchPanel('stock'); }));
  hdrRight.appendChild(makeBtn('btn btn-danger btn-sm', '&#x21A9; คืนคลัง/ล้างรายการ', function() { confirmClearList(sheetId); }));
  hdr.appendChild(hdrRight);
  card.appendChild(hdr);

  var contentContainer = document.createElement('div');

  // --- RENDER BASED ON VIEW MODE ---
  if (productViewMode === 'list') {
    // 1. LIST VIEW (Original Table)
    var scrollWrap = document.createElement('div'); scrollWrap.style.overflowX = 'auto';
    var tbl = document.createElement('table'); tbl.className = 'data-table'; tbl.id = 'prodTable';
    tbl.innerHTML = '<thead><tr><th style="width:34px;"></th><th>สินค้า</th><th>ราคาเต็ม</th><th>มัดจำ</th><th>สต็อก</th><th>สถานะ</th><th></th></tr></thead>';
    var tbody = document.createElement('tbody');

    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var isOpen = p.status === 'Open';
      var remVal = (p.remaining === null || p.remaining === undefined) ? '' : p.remaining;
      var tr = document.createElement('tr');

      var tdSel = document.createElement('td');
      var selChk = document.createElement('input');
      selChk.type = 'checkbox'; selChk.className = 'prod-sel';
      selChk.setAttribute('data-row', p.rowIndex);
      selChk.setAttribute('aria-label', 'เลือก ' + p.name);
      tdSel.appendChild(selChk); tr.appendChild(tdSel);

      var tdName = document.createElement('td');
      var nameDiv = document.createElement('div'); nameDiv.style.cssText = 'font-weight:600;font-size:0.85rem;'; nameDiv.textContent = p.name; tdName.appendChild(nameDiv);
      if (p.options) { var optDiv = document.createElement('div'); optDiv.style.cssText = 'font-size:0.72rem;color:var(--text-3);'; optDiv.textContent = 'ตัวเลือก: ' + p.options; tdName.appendChild(optDiv); }
      tr.appendChild(tdName);

      var tdP = document.createElement('td'); tdP.className = 'num'; tdP.textContent = fmt(p.price); tr.appendChild(tdP);
      var tdD = document.createElement('td'); tdD.className = 'num'; tdD.textContent = fmt(p.deposit); tr.appendChild(tdD);

      var tdS = document.createElement('td'); tdS.className = 'num';
      var inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.className = 'stock-input';
      inp.id = 'stock-' + p.rowIndex; inp.value = remVal; inp.placeholder = '∞';
      inp.setAttribute('data-row', p.rowIndex); inp.setAttribute('data-shid', sheetId);
      tdS.appendChild(inp); tr.appendChild(tdS);

      var tdTog = document.createElement('td');
      var tw = div('toggle-wrap'); tw.style.gap = '6px';
      var tLabel = document.createElement('label'); tLabel.className = 'toggle';
      var chk = document.createElement('input'); chk.type = 'checkbox'; chk.className = 'prod-tog';
      chk.setAttribute('data-row', p.rowIndex); chk.setAttribute('data-shid', sheetId); if (isOpen) chk.checked = true;
      var slider = document.createElement('span'); slider.className = 'toggle-slider';
      tLabel.appendChild(chk); tLabel.appendChild(slider);
      var togLbl = document.createElement('span'); togLbl.className = 'prod-tog-lbl'; togLbl.style.fontSize = '0.72rem'; togLbl.textContent = isOpen ? 'เปิด' : 'ปิด';
      tw.appendChild(tLabel); tw.appendChild(togLbl); tdTog.appendChild(tw); tr.appendChild(tdTog);

      var tdActions = document.createElement('td');
      var actWrap = document.createElement('div'); actWrap.style.cssText = 'display:flex;gap:5px;';
      var editBtn = makeBtn('btn-icon prod-edit', SVG_EDIT);
      editBtn.title = 'แก้ไข'; editBtn.setAttribute('data-row', p.rowIndex);
      if (prodReturnablePieces(p) > 0) {
        var retBtn = makeBtn('btn-icon prod-return', '&#x21A9;');
        retBtn.title = 'คืนสต็อกเข้าคลัง'; retBtn.setAttribute('data-row', p.rowIndex); retBtn.setAttribute('data-name', p.name);
        actWrap.appendChild(retBtn);
      }
      var delBtn = makeBtn('btn-icon prod-del', SVG_TRASH);
      delBtn.title = 'ลบ'; delBtn.style.cssText = 'color:var(--error);border-color:var(--error);';
      delBtn.setAttribute('data-row', p.rowIndex); delBtn.setAttribute('data-name', p.name);
      actWrap.appendChild(editBtn); actWrap.appendChild(delBtn);
      tdActions.appendChild(actWrap); tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody); scrollWrap.appendChild(tbl); contentContainer.appendChild(scrollWrap);
    
  } else {
    // 2. GRID VIEW — compact row card:
    //   ☐ [img] name ………………………… [toggle]
    //           ฿120 · มัดจำ ฿30
    //           [ − ][ 57 ][ + ]          [ ✎ ]
    // Delete / return-to-warehouse live in the edit modal (no mis-taps).
    var grid = div('prod-grid');
    for (var j = 0; j < products.length; j++) {
      var pGrid = products[j];
      var remGridVal = (pGrid.remaining === null || pGrid.remaining === undefined) ? '' : pGrid.remaining;
      var pCard = div('pcard' + (pGrid.status === 'Open' ? '' : ' closed'));

      var pSel = document.createElement('input');
      pSel.type = 'checkbox'; pSel.className = 'prod-sel pcard-sel';
      pSel.setAttribute('data-row', pGrid.rowIndex);
      pSel.setAttribute('aria-label', 'เลือก ' + pGrid.name);
      pCard.appendChild(pSel);

      var pIW = div('pcard-img');
      if (pGrid.image) { var pImg = document.createElement('img'); pImg.src = pGrid.image; pImg.alt = ''; pImg.loading = 'lazy'; pImg.onerror = function() { this.src = PLACEHOLDER; }; pIW.appendChild(pImg); }
      else { pIW.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'; }
      pCard.appendChild(pIW);

      var pMain = div('pcard-main');
      var pTop = div('pcard-top');
      var pTt = div('pcard-name'); pTt.textContent = pGrid.name; pTt.title = pGrid.name; pTop.appendChild(pTt);
      var pTL = document.createElement('label'); pTL.className = 'toggle'; pTL.title = 'เปิด/ปิดขาย';
      var pCk = document.createElement('input'); pCk.type = 'checkbox'; pCk.className = 'prod-tog';
      pCk.setAttribute('aria-label', 'เปิดขาย ' + pGrid.name);
      pCk.setAttribute('data-row', pGrid.rowIndex); pCk.setAttribute('data-shid', sheetId); if (pGrid.status === 'Open') pCk.checked = true;
      var pSld = document.createElement('span'); pSld.className = 'toggle-slider';
      pTL.appendChild(pCk); pTL.appendChild(pSld); pTop.appendChild(pTL);
      pMain.appendChild(pTop);

      var meta = baht(pGrid.price) + (Number(pGrid.deposit) > 0 ? ' · มัดจำ ' + baht(pGrid.deposit) : '');
      var pMeta = div('pcard-meta'); pMeta.textContent = meta;
      if (pGrid.options) { var pOpt = document.createElement('span'); pOpt.className = 'pcard-opts'; pOpt.textContent = ' · ' + String(pGrid.options).split(',').length + ' ตัวเลือก'; pOpt.title = pGrid.options; pMeta.appendChild(pOpt); }
      pMain.appendChild(pMeta);

      var pBot = div('pcard-bottom');
      var pStep = div('pcard-stepper');
      var pMinus = makeBtn('pstep', '&#x2212;'); pMinus.type = 'button'; pMinus.setAttribute('data-d', '-1'); pMinus.setAttribute('aria-label', 'ลดสต็อก');
      var pSI = document.createElement('input'); pSI.type = 'number'; pSI.min = '0'; pSI.inputMode = 'numeric'; pSI.className = 'stock-input';
      pSI.id = 'stock-' + pGrid.rowIndex; pSI.value = remGridVal; pSI.placeholder = '∞';
      pSI.setAttribute('aria-label', 'สต็อก ' + pGrid.name);
      pSI.setAttribute('data-row', pGrid.rowIndex); pSI.setAttribute('data-shid', sheetId);
      var pPlus = makeBtn('pstep', '+'); pPlus.type = 'button'; pPlus.setAttribute('data-d', '1'); pPlus.setAttribute('aria-label', 'เพิ่มสต็อก');
      pStep.appendChild(pMinus); pStep.appendChild(pSI); pStep.appendChild(pPlus);
      pBot.appendChild(pStep);
      var pEB = makeBtn('btn-icon prod-edit', SVG_EDIT); pEB.title = 'แก้ไข'; pEB.setAttribute('aria-label', 'แก้ไข ' + pGrid.name); pEB.setAttribute('data-row', pGrid.rowIndex);
      pBot.appendChild(pEB);
      pMain.appendChild(pBot);

      pCard.appendChild(pMain);
      grid.appendChild(pCard);
    }
    contentContainer.appendChild(grid);
  }

  card.appendChild(contentContainer);

  // Order here = order customers see in the shop
  enableReorder(contentContainer.querySelectorAll('#prodTable tbody tr, .prod-grid > .pcard'),
    products.map(function(p) { return p.rowIndex; }), function(order) {
      contentContainer.classList.add('busy');
      apiCall('adminReorderProducts', sheetId, order).then(function(res) {
        contentContainer.classList.remove('busy');
        if (res.status !== 'Success') { toast(res.message || 'จัดลำดับไม่สำเร็จ', 'error'); return; }
        toast('บันทึกลำดับแล้ว', 'success'); loadProducts(sheetId);
      });
    }, function(node) { return node.querySelector('.pcard-bottom') || node.querySelector('td:last-child > div'); });

  // ── Sticky save bar ──
  var saveBar = document.createElement('div');
  saveBar.className = 'sticky-save-bar';
  var saveCountEl = document.createElement('span');
  saveCountEl.className = 'save-count';
  saveCountEl.id = 'stockSaveCount';
  saveCountEl.textContent = 'ยังไม่มีการเปลี่ยนแปลง';
  var saveAllBtnBar = makeBtn('btn btn-success', '&#x2713; บันทึกสต็อก', saveAllStock);
  saveAllBtnBar.id = 'saveAllBtnBar';
  saveBar.appendChild(saveCountEl);
  saveBar.appendChild(saveAllBtnBar);

  // ── Bulk-selection bar (appears when products are checked) ──
  var bulkBar = document.createElement('div');
  bulkBar.className = 'sticky-save-bar'; bulkBar.id = 'prodBulkBar';
  bulkBar.style.display = 'none';
  bulkBar.style.borderRadius = '0';
  var bulkCount = document.createElement('span');
  bulkCount.className = 'save-count has-changes'; bulkCount.id = 'prodBulkCount';
  var bulkBtns = document.createElement('div');
  bulkBtns.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  bulkBtns.appendChild(makeBtn('btn btn-ghost btn-sm', 'เลือกทั้งหมด', function() { setAllProdSelection(true); }));
  bulkBtns.appendChild(makeBtn('btn btn-ghost btn-sm', 'ล้างที่เลือก', function() { setAllProdSelection(false); }));
  bulkBtns.appendChild(makeBtn('btn btn-primary btn-sm', '&#x21A9; คืนคลังที่เลือก', function() { confirmBulkReturn(sheetId); }));
  bulkBtns.appendChild(makeBtn('btn btn-danger btn-sm', '&#x1F5D1; ลบที่เลือก', function() { confirmBulkDelete(sheetId); }));
  bulkBar.appendChild(bulkCount);
  bulkBar.appendChild(bulkBtns);

  // One sticky container so the two bars stack instead of overlapping
  var stickyWrap = document.createElement('div');
  stickyWrap.style.cssText = 'position:sticky;bottom:0;z-index:100;';
  stickyWrap.appendChild(bulkBar);
  stickyWrap.appendChild(saveBar);
  card.appendChild(stickyWrap);

  holder.appendChild(card);

  // --- EVENT DELEGATION FOR BOTH VIEWS ---
  contentContainer.onchange = function(e) {
    if (e.target.classList.contains('prod-sel')) {
      _prodSelected[parseInt(e.target.getAttribute('data-row'), 10)] = e.target.checked;
      refreshProdBulkBar();
      return;
    }
    var tog = e.target.closest('.prod-tog'); if (!tog) return;
    var row = parseInt(tog.getAttribute('data-row'), 10);
    var sid = tog.getAttribute('data-shid');

    // Attempt to find the label if it's in list view
    var toggleWrap = tog.closest('.toggle-wrap');
    var lbl2 = toggleWrap ? toggleWrap.querySelector('.prod-tog-lbl') : null;

    toggleProductStatus(tog, row, sid, lbl2);

    // Update cache silently to persist state when switching views
    for(var c=0; c<currentProductsCache.length; c++) {
      if(currentProductsCache[c].rowIndex === row) {
        currentProductsCache[c].status = tog.checked ? 'Open' : 'Closed';
        break;
      }
    }
  };

  // Sync stock inputs + track changes
  contentContainer.addEventListener('input', function(e) {
    if(e.target.classList.contains('stock-input')) {
      var row = parseInt(e.target.getAttribute('data-row'), 10);
      for(var c=0; c<currentProductsCache.length; c++) {
        if(currentProductsCache[c].rowIndex === row) {
          currentProductsCache[c].remaining = e.target.value === '' ? null : Number(e.target.value);
          break;
        }
      }
      // Mark changed
      e.target.classList.add('changed');
      _changedStockRows[row] = true;
      var n = Object.keys(_changedStockRows).length;
      var lbl = document.getElementById('stockSaveCount');
      if (lbl) { lbl.textContent = 'แก้ไข ' + n + ' รายการ'; lbl.className = 'save-count has-changes'; }
    }
  });

  contentContainer.onclick = function(e) {
    // ± on a card: nudge the stock box; the 'input' event marks it for "บันทึกสต็อก"
    var st = e.target.closest('.pstep');
    if (st) {
      var si = st.parentElement.querySelector('.stock-input');
      // ∞ (blank) stays unlimited — a stray "−" must never turn it into 0 (sold out).
      // Type a number to put a limit on it.
      if (si.value === '') { toast('สินค้านี้ไม่จำกัดจำนวน (∞) — พิมพ์ตัวเลขเพื่อกำหนดสต็อก', 'success'); si.focus(); return; }
      var nv = Math.max(0, (Number(si.value) || 0) + Number(st.getAttribute('data-d')));
      if (String(nv) !== si.value) { si.value = nv; si.dispatchEvent(new Event('input', { bubbles: true })); }
      return;
    }
    var eb = e.target.closest('.prod-edit');
    if (eb) {
      openEditProductModal(parseInt(eb.getAttribute('data-row'), 10));
      return;
    }
    var rb2 = e.target.closest('.prod-return');
    if (rb2) {
      confirmReturnStock(sheetId, parseInt(rb2.getAttribute('data-row'), 10), rb2.getAttribute('data-name'));
      return;
    }
    var db = e.target.closest('.prod-del');
    if (db) {
      var row = parseInt(db.getAttribute('data-row'), 10);
      var name = db.getAttribute('data-name');
      confirmDeleteProduct(sheetId, row, name);
    }
  };
}

// Reverse of "push": send a linked product's unsold stock back to the
// warehouse (list stock -> 0, warehouse += N)
// How many pieces a product can give back to the warehouse right now.
// Option products count their per-option stock, so a product whose total
// shows 0 can still be returned if its options hold stock.
function prodReturnablePieces(p) {
  if (!p || !p.sourceStockItemId) return 0;
  var det = p.optionDetails || [];
  if (det.length) {
    var s = 0;
    det.forEach(function(o) { var q = Number(o.remaining); if (q > 0) s += q; });
    return s;
  }
  return (p.remaining !== null && p.remaining !== undefined && Number(p.remaining) > 0) ? Number(p.remaining) : 0;
}

function confirmReturnStock(sheetId, rowIndex, name) {
  var prod = currentProductsCache.find(function(p) { return p.rowIndex === rowIndex; });
  var qty = prodReturnablePieces(prod);
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x21A9;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">คืนสต็อกเข้าคลัง?</div>' +
    '<div style="font-size:0.85rem;color:var(--text-2);">คืน <strong>' + escapeHtml(name) + '</strong> จำนวน <strong>' + qty + ' ชิ้น</strong> กลับเข้าคลังสินค้า</div>' +
    '<div style="font-size:0.78rem;color:var(--text-3);margin-top:6px;">สต็อกในรายการนี้จะเป็น 0 (สั่งซื้อไม่ได้จนกว่าจะนำเข้าใหม่)</div>';
  el('modalBody').appendChild(wrap);

  openModal('&#x21A9; คืนสต็อกเข้าคลัง', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังคืน...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          toast('คืนสต็อกเข้าคลังแล้ว ' + res.returned + ' ชิ้น', 'success');
          loadProducts(sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false;
      toast('คืนสต็อกไม่สำเร็จ', 'error');
    }).adminReturnProductStock(sheetId, rowIndex);
  }, 'คืนสต็อก');
  el('modal').classList.add('open');
}

function saveAllStock() {
  // Only send rows the user actually edited, in a single batched request
  var changedInputs = document.querySelectorAll('.stock-input.changed');
  if (!changedInputs.length) { toast('ยังไม่มีการเปลี่ยนแปลงสต็อก', 'success'); return; }

  var saveBtn = document.getElementById('saveAllBtnBar');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...'; }

  var sid = changedInputs[0].getAttribute('data-shid');
  var changes = [];
  for (var i = 0; i < changedInputs.length; i++) {
    changes.push({
      rowIndex: parseInt(changedInputs[i].getAttribute('data-row'), 10),
      remaining: changedInputs[i].value === '' ? '' : changedInputs[i].value
    });
  }

  function restoreBtn() {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.innerHTML = '&#x2713; บันทึกสต็อก'; }
  }

  google.script.run.withSuccessHandler(function(r) {
    restoreBtn();
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        toast('บันทึกสต็อกเรียบร้อย (' + res.saved + ' รายการ)', 'success');
        _changedStockRows = {};
        document.querySelectorAll('.stock-input.changed').forEach(function(el) { el.classList.remove('changed'); });
        var lbl = document.getElementById('stockSaveCount');
        if (lbl) { lbl.textContent = 'บันทึกแล้ว ✓'; lbl.className = 'save-count'; }
      } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
    } catch(e2) { toast('เกิดข้อผิดพลาด', 'error'); }
  }).withFailureHandler(function() {
    restoreBtn();
    toast('บันทึกสต็อกไม่สำเร็จ', 'error');
  }).adminUpdateStockBulk(sid, changes);
}

function toggleProductStatus(checkbox, rowIndex, shid, lbl) {
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        var isOpen = res.newStatus === 'Open';
        if (lbl) lbl.textContent = isOpen ? 'เปิด' : 'ปิด';
        toast(isOpen ? 'เปิดสินค้าแล้ว' : 'ปิดสินค้าแล้ว', 'success');
      } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); checkbox.checked = !checkbox.checked; }
    } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); checkbox.checked = !checkbox.checked; }
  }).adminToggleProductStatus(shid, rowIndex);
}

function confirmDeleteProduct(sheetId, rowIndex, name) {
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  var icon = document.createElement('div'); icon.style.cssText = 'font-size:2.5rem;margin-bottom:12px;'; icon.innerHTML = '&#x26A0;&#xFE0F;';
  var t = document.createElement('div'); t.style.cssText = 'font-weight:700;font-size:0.95rem;margin-bottom:8px;'; t.textContent = 'ยืนยันการลบ?';
  var m = document.createElement('div'); m.style.cssText = 'font-size:0.85rem;color:var(--text-2);';
  m.innerHTML = 'ลบ <strong>' + escapeHtml(name) + '</strong> ออกจากรายการสินค้า';
  wrap.appendChild(icon); wrap.appendChild(t); wrap.appendChild(m); el('modalBody').appendChild(wrap);
  openModal('&#x1F5D1; ลบสินค้า', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังลบ...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') { closeModal(); toast('ลบสินค้าแล้ว', 'success'); loadProducts(sheetId); }
        else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).adminDeleteProduct(sheetId, rowIndex);
  }, 'ลบ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

// ── Products multi-select (bulk return / delete / clear list) ──
function getSelectedProdRows() {
  return Object.keys(_prodSelected).filter(function(k) { return _prodSelected[k]; })
    .map(function(k) { return parseInt(k, 10); });
}

function setAllProdSelection(on) {
  document.querySelectorAll('.prod-sel').forEach(function(cb) {
    cb.checked = on;
    _prodSelected[parseInt(cb.getAttribute('data-row'), 10)] = on;
  });
  refreshProdBulkBar();
}

function refreshProdBulkBar() {
  var bar = document.getElementById('prodBulkBar');
  if (!bar) return;
  var n = getSelectedProdRows().length;
  bar.style.display = n ? 'flex' : 'none';
  var lbl = document.getElementById('prodBulkCount');
  if (lbl) lbl.textContent = 'เลือกแล้ว ' + n + ' รายการ';
}

function confirmBulkReturn(sheetId) {
  var rows = getSelectedProdRows();
  if (!rows.length) { toast('ยังไม่ได้เลือกสินค้า', 'error'); return; }
  var eligible = 0, pieces = 0;
  rows.forEach(function(row) {
    var p = currentProductsCache.find(function(c) { return c.rowIndex === row; });
    var q = prodReturnablePieces(p);
    if (q > 0) { eligible++; pieces += q; }
  });
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x21A9;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">คืนสต็อกเข้าคลัง ' + rows.length + ' สินค้า?</div>' +
    (eligible
      ? '<div style="font-size:0.85rem;color:var(--text-2);">จะคืนได้ <strong>' + eligible + ' สินค้า</strong> รวม <strong>' + pieces + ' ชิ้น</strong> (เฉพาะสินค้าที่เชื่อมกับคลังและมีสต็อกเหลือ)</div>'
      : '<div style="font-size:0.85rem;color:var(--danger);">สินค้าที่เลือกไม่มีรายการที่คืนได้ (ต้องเชื่อมกับคลังและมีสต็อกเหลือ)</div>') +
    '<div style="font-size:0.78rem;color:var(--text-3);margin-top:6px;">สต็อกในรายการนี้จะเป็น 0 (สั่งซื้อไม่ได้จนกว่าจะนำเข้าใหม่)</div>';
  el('modalBody').appendChild(wrap);
  openModal('&#x21A9; คืนสต็อกเข้าคลัง', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังคืน...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          toast('คืนสต็อกเข้าคลังแล้ว ' + res.returned + ' ชิ้น (' + res.count + ' สินค้า)', 'success');
          loadProducts(sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false;
      toast('คืนสต็อกไม่สำเร็จ', 'error');
    }).adminReturnProductsBulk(sheetId, rows);
  }, 'คืนสต็อก');
  el('modal').classList.add('open');
}

function confirmBulkDelete(sheetId) {
  var rows = getSelectedProdRows();
  if (!rows.length) { toast('ยังไม่ได้เลือกสินค้า', 'error'); return; }
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x26A0;&#xFE0F;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">ลบสินค้าที่เลือก ' + rows.length + ' รายการ?</div>' +
    '<div style="font-size:0.85rem;color:var(--text-2);">สินค้าจะถูกลบออกจากรายการนี้ถาวร</div>' +
    '<div style="font-size:0.78rem;color:var(--danger);margin-top:6px;">สต็อกที่เหลือจะไม่ถูกคืนเข้าคลังอัตโนมัติ — ถ้าต้องการคืน ให้กด "คืนคลังที่เลือก" ก่อนลบ</div>';
  el('modalBody').appendChild(wrap);
  openModal('&#x1F5D1; ลบสินค้าที่เลือก', '', function() {
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังลบ...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          toast('ลบสินค้าแล้ว ' + res.deleted + ' รายการ', 'success');
          loadProducts(sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false;
      toast('ลบสินค้าไม่สำเร็จ', 'error');
    }).adminDeleteProductsBulk(sheetId, rows);
  }, 'ลบ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

function confirmClearList(sheetId) {
  var total = currentProductsCache.length;
  if (!total) { toast('ไม่มีสินค้าในรายการนี้', 'error'); return; }
  var eligible = 0, pieces = 0;
  currentProductsCache.forEach(function(p) {
    var q = prodReturnablePieces(p);
    if (q > 0) { eligible++; pieces += q; }
  });
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'padding:4px 0;';
  var summary = document.createElement('div');
  summary.style.cssText = 'text-align:center;font-size:0.85rem;color:var(--text-2);margin-bottom:14px;';
  summary.innerHTML = 'สินค้าทั้งหมด <strong>' + total + ' รายการ</strong>' +
    (eligible ? ' &bull; คืนคลังได้ <strong>' + pieces + ' ชิ้น</strong> (' + eligible + ' สินค้า)' : ' &bull; ไม่มีสินค้าที่คืนคลังได้');
  wrap.appendChild(summary);

  function choiceRow(value, checked, title, desc, danger) {
    var lb = document.createElement('label');
    lb.style.cssText = 'display:flex;gap:10px;align-items:flex-start;padding:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:8px;';
    var rd = document.createElement('input');
    rd.type = 'radio'; rd.name = 'clearListMode'; rd.value = value; rd.checked = checked;
    rd.style.cssText = 'width:18px;height:18px;accent-color:var(--primary);margin-top:1px;flex-shrink:0;';
    var tx = document.createElement('div');
    tx.innerHTML = '<div style="font-weight:700;font-size:0.88rem;">' + title + '</div>' +
      '<div style="font-size:0.76rem;color:' + (danger ? 'var(--danger)' : 'var(--text-3)') + ';margin-top:3px;">' + desc + '</div>';
    lb.appendChild(rd); lb.appendChild(tx);
    return lb;
  }
  wrap.appendChild(choiceRow('return', true, '&#x21A9; คืนคลังอย่างเดียว',
    'คืนสต็อกที่เหลือกลับเข้าคลัง สินค้ายังอยู่ในรายการ (สต็อกเป็น 0 จนกว่าจะนำเข้าใหม่)', false));
  wrap.appendChild(choiceRow('clear', false, '&#x1F9F9; คืนคลัง + ลบสินค้าทั้งหมด',
    'คืนสต็อกเข้าคลังแล้วลบสินค้าทุกตัวออกจากรายการ — ย้อนกลับไม่ได้ สินค้าที่ไม่ได้เชื่อมกับคลังจะหายไปพร้อมสต็อกที่เหลือ', true));
  el('modalBody').appendChild(wrap);

  function currentMode() {
    var r = el('modalBody').querySelector('input[name="clearListMode"]:checked');
    return r ? r.value : 'return';
  }
  function syncSaveBtn() {
    var isClear = currentMode() === 'clear';
    el('modalSave').className = isClear ? 'btn btn-danger' : 'btn btn-primary';
    el('modalSave').textContent = isClear ? 'ล้างทั้งหมด' : 'คืนคลัง';
  }
  wrap.addEventListener('change', syncSaveBtn);

  openModal('&#x21A9; คืนคลัง / ล้างรายการ', '', function() {
    var mode = currentMode();
    var saveBtn = el('modalSave'); saveBtn.disabled = true;
    saveBtn.textContent = mode === 'clear' ? 'กำลังล้าง...' : 'กำลังคืน...';
    var runner = google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false; syncSaveBtn();
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal();
          if (mode === 'clear') toast('ลบสินค้า ' + res.deleted + ' รายการ คืนคลัง ' + res.returned + ' ชิ้น', 'success');
          else toast('คืนสต็อกเข้าคลังแล้ว ' + res.returned + ' ชิ้น (' + res.count + ' สินค้า)', 'success');
          loadProducts(sheetId);
        } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false; syncSaveBtn();
      toast('ดำเนินการไม่สำเร็จ', 'error');
    });
    if (mode === 'clear') runner.adminClearListProducts(sheetId);
    else runner.adminReturnProductsBulk(sheetId, currentProductsCache.map(function(p) { return p.rowIndex; }));
  }, 'คืนคลัง');
  syncSaveBtn();
  el('modal').classList.add('open');
}

// ════════════════════════════════
// BILL SUMMARY MESSAGE — the chat message sent with a bill: the items, what's
// left to pay + the delivery fee, how to pay and the delivery rounds.
// Opened from the bills in "ถึงไทย / ส่งบิล".
// ════════════════════════════════
var TH_DAY = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function parseIsoDate(s) { var p = String(s || '').split('-'); return p.length === 3 ? new Date(+p[0], p[1] - 1, +p[2]) : null; }
function thDay(d) { return d ? TH_DAY[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1) : '-'; } // "พ. 5/11"
// First given weekday after a date; never the same day, since rounds go out after the goods arrive
function nextWeekday(from, day) { var d = new Date(from); d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7 || 7)); return d; }

// Placeholders for the template in "⚙️ ตั้งค่าบิล"; each is filled from the bill and the chosen dates
var SUMMARY_KEYS = [
  ['{รายการ}', 'รายการสินค้า บรรทัดละชิ้น'],
  ['{ค่าส่ง}', 'ค่าส่งของบิล'],
  ['{ค้างชำระ}', 'ยอดค้างชำระสินค้า'],
  ['{ยอดโอน}', 'ค้างชำระ + ค่าส่ง'],
  ['{หยวน}', 'บรรทัดยอดหยวน (ว่างถ้าไม่มี)'],
  ['{วันของเข้า}', 'วันที่สินค้าเข้า เช่น ส. 31/10'],
  ['{รอบ1}', 'รอบส่งที่ 1 เช่น พ. 4/11'],
  ['{รอบ2}', 'รอบส่งที่ 2 เช่น ส. 7/11'],
  ['{ตัดรอบ}', 'วันก่อนรอบ 1 เช่น อ.']
];
var SUMMARY_DEFAULT =
  'สวัสดีครับ~ 💌 รายการที่ตัวเองสั่งไว้กำลังเดินทางมาถึงไทยแล้วนะคะ! ด้านล่างนี้คือรายละเอียดรายการที่สั่งไว้ที่กำลังจะเข้าไทยค่ะ รบกวนเช็กชื่อและจำนวนสินค้าอีกทีนะคะ 😊\n\n' +
  '{รายการ}\n\n' +
  '📦 ค่าจัดส่ง + {ค่าส่ง} บาท\n\n' +
  'ยอดค้างชำระสินค้า {ค้างชำระ} + ค่าจัดส่ง {ค่าส่ง} บาท = {ยอดโอน}\n\n' +
  '💸 ยอดโอนทั้งหมด {ยอดโอน} ✅✅✅✅\n\n' +
  '{หยวน}\n\n' +
  '***หากพรีสินค้าที่พรีไว้แล้วต้องการรอส่งพร้อมกันรบกวนแจ้งได้เลยนะคะ\n\n' +
  '🌟 ช่องทางการโอน\n\n' +
  '•TrueMoney : 080-292-7553\n\n' +
  '•กสิกรไทย : 094-8-44664-2\n\n' +
  '•ชื่อบัญชี : ปิยธิดา ก.\n\n' +
  '***หากสแกนด้วยบัตรเครดิตรบกวน+2% นะคะ\n\n' +
  '🗓 รอบจัดส่ง\n' +
  'สินค้าเข้าไม่เกินวัน {วันของเข้า}\n\n' +
  'รอบจัดส่ง (วันหลังของเข้า)\n' +
  'ร้านจัดส่งแค่ สัปดาห์ละ 2 วัน เท่านั้นนะคับ~\n\n' +
  '•โอนก่อน {ตัดรอบ} 18:00 น. → ส่ง {รอบ1}\n' +
  '•โอนหลัง {ตัดรอบ} 18:00 น. เป็นต้นไป → ส่ง {รอบ2}\n\n' +
  'หากสินค้าไม่เข้าตามเวลาที่คาดการจะแจ้งเลื่อนรอบอีกครั้งค่า\n\n' +
  '⏰) ⸻\n\n' +
  '🧾 หลังโอนแล้วอย่าลืมแจ้ง\n' +
  '• สลิปโอนเงิน\n' +
  '• ชื่อ-ที่อยู่\n' +
  '• เบอร์โทรศัพท์\n\n' +
  'เพื่อให้น้อง ๆ ได้ออกเดินทางไปหาอย่างถูกต้องน้าา 💕 ขอบคุณมาก ๆ เลยนะคะที่มารับน้อง ๆ ไปอยู่ด้วย 🧸✨ 💖';
// Saved in app_settings 'bill': { template, fee } — fee = default delivery fee of new bills
var _billSet = { template: '', fee: null };

// o: { items, fee, arrive, round1, round2 } — the dates are Date objects
function summaryMessage(o) {
  var full = 0, paid = 0, yuan = 0, lines = [];
  o.items.forEach(function(r, i) {
    full += Number(r.totalFull) || 0; paid += Number(r.total) || 0; yuan += Number(r.totalYuan) || 0;
    lines.push((i + 1) + '. ' + r.product + ' (' + (Number(r.fullPrice) || 0) + ' x ' + (Number(r.qty) || 1) + ')');
  });
  var rest = Math.max(0, full - paid), fee = Number(o.fee) || 0;
  var val = {
    '{รายการ}': lines.join('\n'), '{ค่าส่ง}': String(fee), '{ค้างชำระ}': fmt(rest), '{ยอดโอน}': fmt(rest + fee),
    '{หยวน}': yuan ? 'ยอดเงินหยวน ¥' + yuan : '', '{วันของเข้า}': thDay(o.arrive), '{รอบ1}': thDay(o.round1), '{รอบ2}': thDay(o.round2),
    // Transfers until 18:00 the day before round 1 make it into round 1
    '{ตัดรอบ}': o.round1 ? TH_DAY[(o.round1.getDay() + 6) % 7] : 'อ.'
  };
  var t = _billSet.template || SUMMARY_DEFAULT;
  SUMMARY_KEYS.forEach(function(k) { t = t.split(k[0]).join(val[k[0]]); });
  return t.replace(/\n{3,}/g, '\n\n'); // an empty {หยวน} leaves no gap
}

function loadBillSettings() {
  return apiCall('adminGetSetting', 'bill').then(function(res) {
    var v = res.status === 'Success' ? res.value || {} : {};
    _billSet = { template: v.template || '', fee: v.fee === undefined || v.fee === '' ? null : v.fee };
    return res;
  });
}

// ⚙️ in "ถึงไทย / ส่งบิล": default delivery fee of new bills + the summary message template
function openBillSettings(after) {
  var body = el('modalBody'); body.innerHTML = '';
  var ff = div('modal-field');
  var fl = document.createElement('label'); fl.htmlFor = 'bsFee'; fl.textContent = 'ค่าส่งเริ่มต้นของบิลใหม่ (บาท)'; ff.appendChild(fl);
  var fee = document.createElement('input'); fee.id = 'bsFee'; fee.type = 'number'; fee.min = '0'; fee.step = '1'; fee.inputMode = 'decimal';
  fee.placeholder = 'ว่าง = ใส่เองทุกบิล'; fee.value = _billSet.fee === null ? '' : _billSet.fee; ff.appendChild(fee);
  body.appendChild(ff);

  var tf = div('modal-field');
  var tl = document.createElement('label'); tl.htmlFor = 'bsTpl'; tl.textContent = 'ข้อความสรุปยอด'; tf.appendChild(tl);
  var keys = div('tpl-keys');
  keys.appendChild(div('slip-meta', 'แตะเพื่อแทรก — ระบบจะแทนด้วยข้อมูลของบิลตอนเปิดข้อความ'));
  var ta = document.createElement('textarea'); ta.id = 'bsTpl'; ta.className = 'summary-text';
  ta.value = _billSet.template || SUMMARY_DEFAULT;
  SUMMARY_KEYS.forEach(function(k) {
    var c = makeBtn('tpl-key', escapeHtml(k[0]), function() {
      var s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + k[0] + ta.value.slice(e);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + k[0].length;
    });
    c.type = 'button'; c.title = k[1]; keys.appendChild(c);
  });
  tf.appendChild(keys); tf.appendChild(ta);
  var reset = makeBtn('btn btn-ghost btn-sm', 'คืนค่าข้อความเริ่มต้น', function() {
    askConfirm('แทนข้อความด้วยข้อความเริ่มต้น?', 'คืนค่า').then(function(ok) { if (ok) ta.value = SUMMARY_DEFAULT; });
  });
  reset.type = 'button'; tf.appendChild(reset);
  body.appendChild(tf);

  openModal('&#x2699;&#xFE0F; ตั้งค่าบิล', '', function() {
    var f = fee.value.trim() === '' ? null : Number(fee.value);
    if (f !== null && !(f >= 0 && f <= 100000)) { toast('ค่าส่งไม่ถูกต้อง', 'error'); return; }
    // Saving the default text unchanged keeps following future default changes
    var value = { template: ta.value.trim() === SUMMARY_DEFAULT.trim() ? '' : ta.value, fee: f };
    el('modalSave').disabled = true;
    apiCall('adminSaveSetting', 'bill', value).then(function(r) {
      el('modalSave').disabled = false;
      if (r.status !== 'Success') { toast(r.message || 'บันทึกไม่สำเร็จ', 'error'); return; }
      _billSet = value;
      closeModal(); toast('บันทึกการตั้งค่าบิลแล้ว', 'success');
      if (after) after();
    });
  }, 'บันทึก');
}

// Dates are remembered for the next bill: one shipment usually covers many customers
var _sumDates = null;
function openBillSummary(items, fee, who) {
  var body = el('modalBody'); body.innerHTML = '';
  var today = new Date(); today.setHours(0, 0, 0, 0);
  var d = _sumDates || { arrive: isoDate(today), auto1: true, auto2: true };
  var grid = div('summary-form-grid');
  function field(label, val) {
    var w = div('modal-field');
    var l = document.createElement('label'); l.textContent = label; w.appendChild(l);
    var inp = document.createElement('input'); inp.type = 'date'; inp.value = val || ''; w.appendChild(inp);
    grid.appendChild(w);
    return inp;
  }
  var fArrive = field('วันที่สินค้าเข้า', d.arrive);
  var f1 = field('รอบส่งที่ 1 (พุธ)', d.round1);
  var f2 = field('รอบส่งที่ 2 (เสาร์)', d.round2);
  body.appendChild(grid);
  var ta = document.createElement('textarea'); ta.className = 'summary-text'; ta.readOnly = true;
  ta.setAttribute('aria-label', 'ข้อความสรุปยอด');
  body.appendChild(ta);
  var copy = makeBtn('btn btn-primary summary-copy', '&#x1F4CB; คัดลอกข้อความ', function() {
    var done = function() { toast('คัดลอกแล้ว!', 'success'); };
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).then(done, function() { ta.select(); document.execCommand('copy'); done(); });
    else { ta.select(); document.execCommand('copy'); done(); }
  });
  copy.type = 'button'; body.appendChild(copy);

  // Round 1 = the Wednesday after arrival, round 2 = the Saturday after round 1
  // (late transfers go in the later round); each follows along until edited by hand
  function autoRounds() {
    var a = parseIsoDate(fArrive.value);
    if (a && d.auto1) f1.value = isoDate(nextWeekday(a, 3));
    var r1 = parseIsoDate(f1.value);
    if (r1 && d.auto2) f2.value = isoDate(nextWeekday(r1, 6));
  }
  function update() {
    _sumDates = { arrive: fArrive.value, round1: f1.value, round2: f2.value, auto1: d.auto1, auto2: d.auto2 };
    ta.value = summaryMessage({ items: items, fee: fee, arrive: parseIsoDate(fArrive.value),
      round1: parseIsoDate(f1.value), round2: parseIsoDate(f2.value) });
  }
  if (!f1.value || !f2.value) autoRounds();
  fArrive.onchange = function() { autoRounds(); update(); };
  f1.onchange = function() { d.auto1 = false; autoRounds(); update(); };
  f2.onchange = function() { d.auto2 = false; update(); };
  update();
  openModal('&#x1F4AC; สรุปยอด · ' + escapeHtml(who), '', null);
}

// ════════════════════════════════
// CREATE ORDER LIST
// ════════════════════════════════
function openCreateOrderListModal() {
  el('modalBody').innerHTML = '';

  var mode = 'link';

  // Label row with pill toggle
  var urlLabelRow = document.createElement('div');
  urlLabelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';

  var urlLabel = document.createElement('label');
  urlLabel.textContent = 'URL Spreadsheet *';
  urlLabel.style.cssText = 'font-size:0.82rem;font-weight:600;color:var(--text-2);margin:0;';

  var pill = document.createElement('div');
  pill.style.cssText = 'display:inline-flex;align-items:center;background:var(--surface-2);border:1.5px solid var(--border);border-radius:999px;padding:2px;gap:2px;';

  function makePillBtn(label, val) {
    var b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('data-val', val);
    b.style.cssText = 'border:none;border-radius:999px;padding:3px 11px;font-size:0.74rem;font-weight:600;font-family:var(--font);cursor:pointer;transition:background 0.15s,color 0.15s;';
    return b;
  }

  var btnLink   = makePillBtn('📥 นำเข้าชีตเก่า', 'link');
  var btnCreate = makePillBtn('✨ สร้างใหม่', 'create');
  pill.appendChild(btnLink);
  pill.appendChild(btnCreate);
  urlLabelRow.appendChild(urlLabel);
  urlLabelRow.appendChild(pill);

  var urlInput = document.createElement('input');
  urlInput.id = 'cUrl'; urlInput.type = 'text';
  urlInput.placeholder = 'https://docs.google.com/spreadsheets/d/...';
  urlInput.style.cssText = 'width:100%;box-sizing:border-box;';

  var nameInput = document.createElement('input');
  nameInput.id = 'cNewName'; nameInput.type = 'text';
  nameInput.placeholder = 'เช่น รอบพรีออเดอร์ มิ.ย. 2568';
  nameInput.style.cssText = 'width:100%;box-sizing:border-box;display:none;';

  var warn = document.createElement('div');
  warn.style.cssText = 'background:var(--warning-light);border:1.5px solid var(--warning);border-radius:var(--radius-sm);padding:8px 12px;font-size:0.76rem;color:#7A5000;margin-top:6px;';
  warn.innerHTML = '⚠️ ชีตต้องแชร์เป็น <strong>ทุกคนที่มีลิงก์ดูได้</strong> และมีแท็บชื่อ <strong>Products</strong> กับ <strong>Orders</strong> ชื่อรายการจะใช้ชื่อไฟล์ Spreadsheet โดยอัตโนมัติ';

  var info = document.createElement('div');
  info.style.cssText = 'background:#f0efff;border:1.5px solid #c4c0f7;border-radius:var(--radius-sm);padding:8px 12px;font-size:0.76rem;color:#4A4190;margin-top:6px;display:none;';
  info.innerHTML = '✨ ระบบจะสร้างรายการว่างให้ทันที — เพิ่มสินค้าได้เลยหลังสร้าง แล้วค่อยเปิดรับออเดอร์เมื่อพร้อมค่ะ';

  var f1 = div('modal-field');
  f1.style.marginBottom = '0';
  f1.appendChild(urlLabelRow);
  f1.appendChild(urlInput);
  f1.appendChild(nameInput);
  f1.appendChild(warn);
  f1.appendChild(info);
  el('modalBody').appendChild(f1);

  var f2 = div('modal-field');
  var l2 = document.createElement('label'); l2.textContent = 'คำอธิบาย (ไม่บังคับ)';
  var i2 = document.createElement('input'); i2.id = 'cDesc'; i2.type = 'text';
  i2.placeholder = 'รายละเอียดสั้นๆ เช่น ปิดรับ 31 ธ.ค.';
  f2.appendChild(l2); f2.appendChild(i2);
  el('modalBody').appendChild(f2);

  // Image shown in BOTH modes
  el('modalBody').appendChild(makeImageField('cImage', '', 'รูปภาพปก'));

  var f3 = div('modal-field');
  var l3 = document.createElement('label'); l3.textContent = 'สถานะเริ่มต้น';
  var s3 = document.createElement('select'); s3.id = 'cStatus';
  // Default Closed: add products first, then open the list when it's ready
  var o1 = document.createElement('option'); o1.value = 'Closed'; o1.textContent = 'ปิดรับออเดอร์ (เปิดทีหลังเมื่อพร้อม)';
  var o2 = document.createElement('option'); o2.value = 'Open'; o2.textContent = 'เปิดรับออเดอร์ทันที';
  s3.appendChild(o1); s3.appendChild(o2);
  f3.appendChild(l3); f3.appendChild(s3);
  el('modalBody').appendChild(f3);

  function applyMode(m) {
    mode = m;
    var isCreate = m === 'create';

    btnLink.style.background   = isCreate ? 'transparent' : 'var(--primary)';
    btnLink.style.color        = isCreate ? 'var(--text-3)' : '#fff';
    btnCreate.style.background = isCreate ? 'var(--primary)' : 'transparent';
    btnCreate.style.color      = isCreate ? '#fff' : 'var(--text-3)';

    urlLabel.textContent = isCreate ? 'ชื่อรายการสั่งซื้อ *' : 'URL Spreadsheet *';
    urlInput.style.display  = isCreate ? 'none' : 'block';
    nameInput.style.display = isCreate ? 'block' : 'none';
    warn.style.display = isCreate ? 'none' : 'block';
    info.style.display = isCreate ? 'block' : 'none';
    s3.value = isCreate ? 'Open' : 'Closed';

    var saveBtn = el('modalSave');
    if (saveBtn) saveBtn.textContent = isCreate ? '✨ สร้างรายการ' : '📥 นำเข้าข้อมูล';
  }

  pill.onclick = function(e) {
    var btn = e.target.closest('button[data-val]');
    if (btn) applyMode(btn.getAttribute('data-val'));
  };

  applyMode('link');

  openModal('เพิ่มรายการสั่งซื้อ', '', function() {
    var saveBtn = el('modalSave');

    if (mode === 'create') {
      var name = el('cNewName').value.trim();
      if (!name) { toast('กรุณากรอกชื่อรายการ', 'error'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'กำลังสร้าง...';
      // FIX: run resolveImage first so uploaded/pasted image gets sent
      resolveImage('cImage', function(imgUrl) {
        google.script.run
          .withSuccessHandler(function(r) {
            saveBtn.disabled = false; saveBtn.textContent = '✨ สร้างรายการ';
            try {
              var res = JSON.parse(r);
              if (res.status === 'Success') {
                closeModal();
                toast('สร้าง "' + res.name + '" แล้ว! 🎉', 'success');
                loadAllLists(renderOrderLists);
              } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
            } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
          })
          .withFailureHandler(function(e) {
            saveBtn.disabled = false; saveBtn.textContent = '✨ สร้างรายการ';
            toast('เกิดข้อผิดพลาด: ' + (e && e.message || ''), 'error');
          })
          .adminCreateNewOrderList(name, el('cDesc').value.trim(), imgUrl || '', el('cStatus').value);
      });

    } else {
      var url = el('cUrl').value.trim();
      if (!url) { toast('กรุณากรอก URL Spreadsheet', 'error'); return; }
      if (url.indexOf('docs.google.com/spreadsheets') === -1) { toast('URL ไม่ถูกต้อง', 'error'); return; }
      saveBtn.disabled = true; saveBtn.textContent = 'กำลังนำเข้าข้อมูล...';
      resolveImage('cImage', function(imgUrl) {
        google.script.run
          .withSuccessHandler(function(r) {
            saveBtn.disabled = false; saveBtn.textContent = '📥 นำเข้าข้อมูล';
            try {
              var res = JSON.parse(r);
              if (res.status === 'Success') {
                closeModal();
                toast('นำเข้า "' + res.name + '" สำเร็จ: สินค้า ' + res.products + ' / ออเดอร์ ' + res.orders + ' รายการ', 'success');
                loadAllLists(renderOrderLists);
              } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
            } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
          })
          .withFailureHandler(function(e) {
            saveBtn.disabled = false; saveBtn.textContent = '📥 นำเข้าข้อมูล';
            toast('เกิดข้อผิดพลาด: ' + (e && e.message || ''), 'error');
          })
          .adminAddOrderList(url, el('cStatus').value, el('cDesc').value.trim(), imgUrl || '', 'Show');
      });
    }

  }, '📥 นำเข้าข้อมูล');
  el('modal').classList.add('open');
}

// ── Image pick box for the bulk add modal ──
// One tap opens an app chooser for camera, files, or an image URL. The native
// chooser is not reliable because Android may route it straight to Photos.
function makeBulkImgBox(pendingKey, existingUrl, onChange) {
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;flex-shrink:0;';

  var box = document.createElement('div');
  box.style.cssText = 'position:relative;width:64px;height:64px;border-radius:10px;border:1.5px solid var(--border);background:var(--surface-2);overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:border-color 0.15s;';
  var svgHtml = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  box.innerHTML = svgHtml;
  var prev = document.createElement('img');
  prev.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:none;';
  // Re-renders (add option / add product) must not lose a picked image:
  // restore the preview from the pending upload buffer
  var shownUrl = existingUrl || pendingImg[pendingKey] || '';
  if (shownUrl) { prev.src = shownUrl; prev.style.display = 'block'; box.style.borderColor = 'var(--success)'; box.innerHTML = ''; }
  box.appendChild(prev);

  function applyFile(file) {
    if (!file) return;
    var rdr = new FileReader();
    rdr.onload = function(ev) {
      pendingImg[pendingKey] = ev.target.result;
      prev.src = ev.target.result; prev.style.display = 'block';
      box.style.borderColor = 'var(--success)';
      var s2 = box.querySelector('svg'); if (s2) s2.style.display = 'none';
      if (onChange) onChange('__pending__' + pendingKey);
    };
    rdr.readAsDataURL(file);
  }

  function applyUrl(url) {
    delete pendingImg[pendingKey];
    prev.src = url; prev.style.display = 'block';
    box.style.borderColor = 'var(--success)';
    var s2 = box.querySelector('svg'); if (s2) s2.style.display = 'none';
    if (onChange) onChange(url);
  }

  var fi = document.createElement('input'); fi.type = 'file'; fi.accept = 'image/*';
  fi.className = 'img-source-input';
  fi.onclick = function(e) { e.stopPropagation(); };
  fi.setAttribute('aria-label', 'เลือกรูป (กล้องหรือแกลเลอรี)');
  fi.onchange = function() { applyFile(this.files && this.files[0]); };
  box.appendChild(fi);
  wrap.appendChild(box);

  var cameraCapture = makeCameraCapture(function(file) { applyFile(file); });
  wrap.appendChild(cameraCapture.input);
  bindImageActionPicker(box, cameraCapture.input, fi, applyUrl);

  return { el: wrap, preview: prev };
}

// After "+ add product" in a bulk modal: bring the new card on screen and
// put the cursor in its name field so typing can start right away
function focusLastBulkCard(list) {
  var card = list.lastElementChild; if (!card) return;
  card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  var name = card.querySelector('input[type=text]');
  if (name) name.focus({ preventScroll: true });
}

// ── Shared pieces for the edit forms (list product, warehouse product, variant) ──
// Same look as the bulk-add card. Each piece keeps the element ids the save
// handlers already read, so only the layout changes.
function fkInput(id, type, val, ph) {
  var i = document.createElement('input'); i.id = id; i.type = type || 'text'; i.className = 'bcard-input';
  if (type === 'number') { i.min = '0'; i.inputMode = 'decimal'; }
  if (val !== undefined && val !== null) i.value = val;
  if (ph) i.placeholder = ph;
  return i;
}
function fkField(label, control, forId) {
  var f = div('bcard-field');
  var l = document.createElement('label'); l.className = 'bcard-label'; l.textContent = label; if (forId) l.htmlFor = forId;
  f.appendChild(l); f.appendChild(control); return f;
}
// [photo] [name] — a picked file waits in pendingImg[imgId] (uploaded on save
// by resolveImage); a picked URL goes into the hidden #imgId
function fkPhotoName(imgId, imgUrl, nameId, nameVal, nameLabel) {
  var top = div('ep-top');
  var hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.id = imgId; hidden.value = imgUrl || '';
  var box = makeBulkImgBox(imgId, imgUrl || '', function(v) { if (!/^__pending__/.test(v)) hidden.value = v; });
  box.el.classList.add('ep-img'); box.el.title = 'แตะเพื่อเปลี่ยนรูป';
  top.appendChild(box.el); top.appendChild(hidden);
  var n = fkInput(nameId, 'text', nameVal, nameLabel); n.classList.add('bcard-name');
  top.appendChild(fkField(nameLabel, n, nameId));
  return top;
}
// [−][ 57 ][+] — ∞ (blank) stays ∞: a stray "−" must never turn it into 0 (sold out)
function fkStock(id, val) {
  var wrap = div('pcard-stepper');
  var si = fkInput(id, 'number', val === null || val === undefined ? '' : val, '∞');
  si.classList.add('ep-stock'); si.inputMode = 'numeric';
  [-1, 0, 1].forEach(function(d) {
    if (!d) { wrap.appendChild(si); return; }
    var b = makeBtn('pstep', d > 0 ? '+' : '&#x2212;'); b.type = 'button'; b.setAttribute('aria-label', d > 0 ? 'เพิ่มสต็อก' : 'ลดสต็อก');
    b.onclick = function() {
      if (si.value === '') { toast('สินค้านี้ไม่จำกัดจำนวน (∞) — พิมพ์ตัวเลขเพื่อกำหนดสต็อก', 'success'); si.focus(); return; }
      si.value = Math.max(0, (Number(si.value) || 0) + d);
    };
    wrap.appendChild(b);
  });
  return wrap;
}
// Barcode input + 📷, with the printable picture folded under "ดู / บันทึกรูปบาร์โค้ด".
// Returns the elements to append (field, then the fold).
function fkBarcode(id, val, label, placeholder) {
  var row = div('bcard-bc');
  var input = fkInput(id, 'text', val, placeholder || 'สแกนหรือพิมพ์บาร์โค้ด'); input.classList.add('bcard-mono');
  var fold = document.createElement('details'); fold.className = 'bcard-more ep-bc';
  var sum = document.createElement('summary'); sum.textContent = 'ดู / บันทึกรูปบาร์โค้ด'; fold.appendChild(sum);
  var pic = div('bc-preview-wrap'); pic.id = id + '_barcode';
  var cv = document.createElement('canvas'); cv.id = id + '_canvas'; pic.appendChild(cv); fold.appendChild(pic);
  function draw() { if (fold.open && input.value.trim()) generateBarcode(input.value.trim(), id); }
  fold.ontoggle = draw;
  input.addEventListener('input', function() { if (input.value.trim().length >= 4) draw(); });
  var scan = makeBtn('bcard-scan', '&#x1F4F7;'); scan.type = 'button'; scan.setAttribute('aria-label', 'สแกนบาร์โค้ด');
  scan.onclick = function() { scanBarcodeInto(input, scan, draw); };
  row.appendChild(input); row.appendChild(scan);
  return [fkField(label || 'บาร์โค้ด / ID สินค้า *', row, id), fold];
}
function fkMore(summary, open) {
  var d = document.createElement('details'); d.className = 'bcard-more'; d.open = !!open;
  var s = document.createElement('summary'); s.textContent = summary; d.appendChild(s);
  return d;
}
function fkParentChip(name) {
  var c = div('ep-parent'); c.textContent = 'ตัวเลือกของ: ' + name; return c;
}

function openEditProductModal(rowIndex) {
  var prod = currentProductsCache.find(function(p) { return p.rowIndex === rowIndex; });
  if (!prod) return;
 
  // [photo][name] / price chips / deposit + stock± / barcode+📷 / ▸ more (yuan, options) / danger
  el('modalBody').innerHTML = '';
  var form = div('epform'); el('modalBody').appendChild(form);
  form.appendChild(fkPhotoName('epImage', prod.image, 'epName', prod.name, 'ชื่อสินค้า *'));
  var priceInp = document.createElement('input'); priceInp.id = 'epPrice'; priceInp.value = prod.price;
  form.appendChild(fkField('ราคาเต็ม', makePriceChips(priceInp)));
  var pair = div('bcard-pair ep-pair');
  pair.appendChild(fkField('มัดจำ (฿)', fkInput('epDeposit', 'number', prod.deposit, '0'), 'epDeposit'));
  pair.appendChild(fkField('สต็อก', fkStock('epRemaining', prod.remaining), 'epRemaining'));
  form.appendChild(pair);
  fkBarcode('epId', prod.id).forEach(function(n) { form.appendChild(n); });
  var more = fkMore('เพิ่มเติม' + (prod.options ? ' · ' + String(prod.options).split(',').length + ' ตัวเลือก' : ' — ราคาหยวน, ตัวเลือก'), !!prod.options);
  more.appendChild(fkField('ราคาหยวน (¥)', fkInput('epYuan', 'number', prod.yuan || 0, '0'), 'epYuan'));
  var optWrap = div('ep-opts'); optWrap.appendChild(makeOptionsField('epOptions', prod.options || ''));
  more.appendChild(optWrap);
  form.appendChild(more);

  // Destructive actions live here, not on the card, so a stray tap can't hit them
  var danger = div('edit-danger');
  var sheetId = currentProductsSheetId;
  var returnable = prodReturnablePieces(prod);
  if (returnable > 0) {
    danger.appendChild(makeBtn('btn btn-ghost btn-sm', '&#x21A9; คืนเข้าคลัง (' + returnable + ' ชิ้น)', function() {
      closeModal(); confirmReturnStock(sheetId, rowIndex, prod.name);
    }));
  }
  danger.appendChild(makeBtn('btn btn-danger btn-sm', '&#x1F5D1; ลบสินค้านี้', function() {
    closeModal(); confirmDeleteProduct(sheetId, rowIndex, prod.name);
  }));
  form.appendChild(danger);

  openModal('&#x270F;&#xFE0F; แก้ไขสินค้า', '', function() {
    var name = el('epName').value.trim(), id = el('epId').value.trim();
    if (!name || !id) { toast('กรุณากรอกชื่อและ ID สินค้า', 'error'); return; }
    stopBarcodeScanner()
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...';
    resolveImage('epImage', function(imgUrl) {
      var epOptNames = el('epOptions') ? el('epOptions').value.trim() : '';
      var epOptBcRaw = el('epOptions_barcodes') ? el('epOptions_barcodes').value.trim() : '';
      var epFinalOpts = packageOptionsWithBarcodes(epOptNames, epOptBcRaw);
      google.script.run.withSuccessHandler(function(r) {
        saveBtn.disabled = false; saveBtn.textContent = 'บันทึกการแก้ไข';
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') {
            closeModal();
            toast('แก้ไขสินค้าเรียบร้อย!', 'success');
            loadProducts(currentProductsSheetId);
          } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
        } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
      }).adminUpdateProduct(
        currentProductsSheetId, rowIndex, id, name,
        imgUrl || prod.image,
        el('epPrice').value, el('epDeposit').value, el('epRemaining').value, el('epYuan').value,
        epFinalOpts
      );
    });
  }, 'บันทึกการแก้ไข');
}


// ════════════════════════════════════════════════════════════
// STOCK PANEL — Level-based schema
// ════════════════════════════════════════════════════════════
var stockCache = []; // [{rowIndex, id, name, image, price, deposit, yuan, stock, status, linkedListIds, children:[]}]

// ════════════════════════════════════════════════════════════
// WAREHOUSE — pick the destination list, then what goes into it
//   นำเข้าไปที่ [Pre-order Oct ▼]
//   ○ [photo]   name … / ฿150 · 6 แบบ · เหลือ 12     ← tap = select (variants open a picker)
//   [🔍 search ……………… 📷]                              ← bottom bar
//   เลือก 3 รายการ · 8 ชิ้น   [ล้าง] [นำเข้า →]         ← appears once something is selected
// ════════════════════════════════════════════════════════════
var stockSearchQuery = '';
var _stockSelected = {};    // parent rowIndex → true
var _stockQtyMap = {};      // single product rowIndex → qty to import
var _stockVariantQty = {};  // variant product rowIndex → { childRowIndex: qty } (unlimited variant: 1 = included)
var _whTarget = '';         // order list the import goes into
var _whDelMode = false;     // "เลือกลบ" mode: taps pick products to delete instead of import
var _stockDelSelected = {}; // parent rowIndex → true (delete mode)
var _whVisibleRows = [];    // rowIndexes currently shown (after search) — what "เลือกทั้งหมด" picks

// What happened to the photos of deleted stock items, for the toast
function photoNote(p) {
  if (!p || p.notSetUp) return '';
  if (p.error) return ' · ลบรูปบน Cloudinary ไม่สำเร็จ';
  return p.deleted ? ' · ลบรูปบน Cloudinary ' + p.deleted + ' รูป' : '';
}

function renderStockPanel() {
  _whDelMode = false; _stockDelSelected = {};
  renderStockTopbar();
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  loadStock(renderStockContent);
}

function renderStockTopbar() {
  setTopbar('คลังสินค้า', _whDelMode ? 'แตะสินค้าที่จะลบ หรือกด "เลือกทั้งหมด"' : 'เลือกรายการปลายทาง แล้วเลือกสินค้าที่จะนำเข้า');
  el('topbarActions').innerHTML = '';
  if (_whDelMode) {
    el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x2715; ยกเลิกการลบ', function() { whSetDelMode(false); }));
    return;
  }
  el('topbarActions').appendChild(makeBtn('btn btn-primary btn-sm', '&#x2B; เพิ่มสินค้า', openCreateStockModal));
  el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; เพิ่มหลาย', openBulkStockModal));
  el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F5D1; เลือกลบ', function() { whSetDelMode(true); }));
  var refBtn = makeBtn('btn btn-ghost btn-sm', '&#x21BB;', function() { loadStock(renderStockContent); });
  refBtn.title = 'รีเฟรช'; refBtn.setAttribute('aria-label', 'รีเฟรช');
  el('topbarActions').appendChild(refBtn);
  var sweep = makeBtn('btn btn-ghost btn-sm', '&#x1F9F9;', openPhotoSweep);
  sweep.title = 'ล้างรูปบน Cloudinary ที่ไม่ได้ใช้แล้ว'; sweep.setAttribute('aria-label', sweep.title);
  el('topbarActions').appendChild(sweep);
}

// Lists the Cloudinary photos nothing in the shop shows any more, then deletes them on request
function openPhotoSweep() {
  var body = el('modalBody'); body.innerHTML = '';
  body.appendChild(makeSpinner());
  body.appendChild(div('slip-meta', 'กำลังตรวจรูปทั้งหมดบน Cloudinary เทียบกับรูปที่ร้านใช้อยู่...'));
  openModal('&#x1F9F9; ล้างรูปที่ไม่ได้ใช้', '', null);
  apiCall('adminCloudinary', 'scan').then(function(res) {
    body.innerHTML = '';
    if (res.status !== 'Success') {
      body.appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message || 'ตรวจไม่สำเร็จ')));
      return;
    }
    var unused = res.unused || [], bytes = 0;
    unused.forEach(function(u) { bytes += Number(u.bytes) || 0; });
    Object.keys(res.totals || {}).forEach(function(cloud) {
      var t = res.totals[cloud];
      body.appendChild(div('sweep-acct', '<strong>' + escapeHtml(cloud) + '</strong> · ทั้งหมด ' + t.all + ' รูป · ไม่ได้ใช้ ' + t.unused + ' รูป (' + mb(t.bytes) + ')'));
    });
    if (!unused.length) { body.appendChild(div('state-empty', '&#x2728; ไม่มีรูปที่ไม่ได้ใช้')); return; }
    body.appendChild(div('sweep-warn', '⚠️ รูปที่ไม่มีอะไรในเว็บนี้ใช้อยู่ จะถูกลบถาวร — ถ้าเคยใช้รูปเหล่านี้ที่อื่น (เช่น Google Sheet เก่า หรือโพสต์ที่ลิงก์รูปไว้) รูปที่นั่นจะหายด้วย'));
    var grid = div('sweep-grid');
    unused.slice(0, 60).forEach(function(u) {
      var im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.title = u.id;
      im.src = String(u.url).replace('/image/upload/', '/image/upload/w_120,h_120,c_fill,q_auto,f_auto/');
      grid.appendChild(im);
    });
    body.appendChild(grid);
    if (unused.length > 60) body.appendChild(div('slip-meta', 'แสดง 60 จาก ' + unused.length + ' รูป'));
    openModal('&#x1F9F9; ล้างรูปที่ไม่ได้ใช้', '', function() {
      askConfirm('ลบรูปที่ไม่ได้ใช้ ' + unused.length + ' รูป (' + mb(bytes) + ') ออกจาก Cloudinary ถาวร?', 'ลบรูป').then(function(ok) {
        if (!ok) return;
        el('modalSave').disabled = true; el('modalSave').textContent = 'กำลังลบ...';
        apiCall('adminCloudinary', 'delete', { items: unused.map(function(u) { return { cloud: u.cloud, id: u.id }; }) }).then(function(r) {
          if (r.status !== 'Success') { el('modalSave').disabled = false; el('modalSave').textContent = 'ลบ ' + unused.length + ' รูป'; toast(r.message || 'ลบไม่สำเร็จ', 'error'); return; }
          closeModal(); toast('ลบรูปบน Cloudinary แล้ว ' + r.deleted + ' รูป', 'success');
        });
      });
    }, 'ลบ ' + unused.length + ' รูป');
    el('modalSave').className = 'btn btn-danger';
  });
  function mb(b) { return (b / 1048576).toFixed(1) + ' MB'; }
}

function whSetDelMode(on) {
  _whDelMode = !!on; _stockDelSelected = {};
  renderStockTopbar();
  renderStockContent();
}

function loadStock(cb) {
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') stockCache = res.products || [];
      else { stockCache = []; toast(res.message || 'โหลดคลังสินค้าไม่สำเร็จ', 'error'); }
    } catch(e) { stockCache = []; }
    if (cb) cb();
  }).adminGetStockProducts();
}

function isTrackedStock(v) { return v !== null && v !== undefined && v !== ''; }
// Total sellable pieces of a warehouse item (variants summed); null = unlimited somewhere
function whStockOf(p) {
  if (p.children && p.children.length) {
    if (p.children.some(function(c) { return !isTrackedStock(c.stock); })) return null;
    return p.children.reduce(function(s, c) { return s + (Number(c.stock) || 0); }, 0);
  }
  return isTrackedStock(p.stock) ? Number(p.stock) : null;
}
function whSoldOut(p) { var s = whStockOf(p); return s !== null && s <= 0; }
function whInTarget(p) { return !!_whTarget && (p.linkedListIds || []).indexOf(_whTarget) !== -1; }
// Pieces chosen for one product (unlimited variants count as 1 for the summary)
function whChosenPieces(p) {
  if (p.children && p.children.length) {
    var m = _stockVariantQty[p.rowIndex] || {};
    return Object.keys(m).reduce(function(s, k) { return s + (Number(m[k]) || 0); }, 0);
  }
  return _stockQtyMap[p.rowIndex] || 1;
}

function renderStockContent() {
  el('content').innerHTML = '';
  var wrap = document.createElement('div'); wrap.className = 'wh';

  // Forget selections for items that no longer exist (after refresh/import)
  Object.keys(_stockSelected).forEach(function(k) {
    if (!stockCache.some(function(p) { return String(p.rowIndex) === k; })) { delete _stockSelected[k]; delete _stockQtyMap[k]; delete _stockVariantQty[k]; }
  });
  Object.keys(_stockDelSelected).forEach(function(k) {
    if (!stockCache.some(function(p) { return String(p.rowIndex) === k; })) delete _stockDelSelected[k];
  });

  // ── 1. Destination list first ──
  var lists = getVisibleLists();
  if (!_whTarget) { try { _whTarget = localStorage.getItem('whTargetList') || ''; } catch (e) {} }
  if (_whTarget && !lists.some(function(l) { return l.sheetId === _whTarget; })) _whTarget = '';
  if (!_whTarget && selectedSheetId && selectedSheetId !== 'ALL' && lists.some(function(l) { return l.sheetId === selectedSheetId; })) _whTarget = selectedSheetId;
  var tgt = div('wh-target');
  var tLbl = document.createElement('label'); tLbl.htmlFor = 'whTargetSel'; tLbl.textContent = 'นำเข้าไปที่';
  var tSel = document.createElement('select'); tSel.id = 'whTargetSel';
  tSel.innerHTML = '<option value="">— เลือกรายการสั่งซื้อ —</option>';
  lists.forEach(function(l) {
    var o = document.createElement('option'); o.value = l.sheetId; o.textContent = l.name + (l.status === 'Open' ? '' : ' (ปิดรับ)');
    if (l.sheetId === _whTarget) o.selected = true;
    tSel.appendChild(o);
  });
  tSel.onchange = function() {
    _whTarget = tSel.value; tgt.classList.remove('need');
    try { localStorage.setItem('whTargetList', _whTarget); } catch (e) {}
    renderStockCards(el('stockCardGrid'), stockSearchQuery);
  };
  tgt.appendChild(tLbl); tgt.appendChild(tSel);
  if (!_whDelMode) wrap.appendChild(tgt);

  // ── Stats: variant stock counts too; unlimited items are counted separately ──
  var total = 0, unlimited = 0;
  stockCache.forEach(function(p) {
    if (p.children && p.children.length) {
      var anyInf = false;
      p.children.forEach(function(c) { if (isTrackedStock(c.stock)) total += Number(c.stock) || 0; else anyInf = true; });
      if (anyInf) unlimited++;
    } else if (isTrackedStock(p.stock)) total += Number(p.stock) || 0;
    else unlimited++;
  });
  var statRow = div('stat-row');
  statRow.appendChild(makeStat('สินค้าในคลัง', stockCache.length, ''));
  statRow.appendChild(makeStat('สต็อกรวม', total.toLocaleString('th-TH') + (unlimited ? ' · ∞ ' + unlimited + ' รายการ' : ''), 'success'));
  wrap.appendChild(statRow);

  var grid = document.createElement('div'); grid.id = 'stockCardGrid'; grid.className = 'wh-grid';
  wrap.appendChild(grid);

  // ── Bottom bar: search + scan; the import row appears once something is selected ──
  var bar = div('wh-bar');
  var sRow = div('wh-search');
  var sInp = document.createElement('input'); sInp.type = 'search'; sInp.id = 'whSearch';
  sInp.placeholder = 'ค้นหาชื่อหรือบาร์โค้ด…'; sInp.setAttribute('aria-label', 'ค้นหาสินค้าในคลัง'); sInp.value = stockSearchQuery;
  sInp.oninput = function() { stockSearchQuery = sInp.value.toLowerCase().trim(); renderStockCards(grid, stockSearchQuery); };
  var scan = makeBtn('wh-scan', '&#x1F4F7;'); scan.type = 'button'; scan.title = 'สแกนเพื่อเลือกสินค้า (สแกนต่อเนื่องได้)'; scan.setAttribute('aria-label', 'สแกนบาร์โค้ดเพื่อเลือกสินค้า');
  scan.onclick = whScanLoop;
  sRow.appendChild(sInp); if (!_whDelMode) sRow.appendChild(scan);
  bar.appendChild(sRow);
  var act = div('wh-act'); act.id = 'whAct';
  var cnt = document.createElement('span'); cnt.className = 'wh-count'; cnt.id = 'whCount';
  if (_whDelMode) {
    act.classList.add('del');
    var all = makeBtn('btn btn-ghost btn-sm', 'เลือกทั้งหมด', function() {
      var allOn = _whVisibleRows.length && _whVisibleRows.every(function(k) { return _stockDelSelected[k]; });
      _whVisibleRows.forEach(function(k) { if (allOn) delete _stockDelSelected[k]; else _stockDelSelected[k] = true; });
      whRerender();
    });
    all.id = 'whSelAllBtn';
    var del = makeBtn('btn btn-danger', '&#x1F5D1; ลบ', confirmDeleteSelectedStock);
    del.id = 'whDelBtn';
    act.appendChild(cnt); act.appendChild(all); act.appendChild(del);
    bar.appendChild(act);
    wrap.appendChild(bar);
    el('content').appendChild(wrap);
    renderStockCards(grid, stockSearchQuery);
    return;
  }
  var clr = makeBtn('btn btn-ghost btn-sm', 'ล้าง', function() { _stockSelected = {}; _stockQtyMap = {}; _stockVariantQty = {}; renderStockCards(grid, stockSearchQuery); });
  var go = makeBtn('btn btn-primary', 'นำเข้า &#x2192;', function() { pushSelectedToShop(_whTarget); });
  go.id = 'stockPushBtn';
  act.appendChild(cnt); act.appendChild(clr); act.appendChild(go);
  bar.appendChild(act);
  wrap.appendChild(bar);

  el('content').appendChild(wrap);
  renderStockCards(grid, stockSearchQuery);
}

function refreshStockPushBar() {
  var act = el('whAct'); if (!act) return;
  if (_whDelMode) {
    var n = Object.keys(_stockDelSelected).length;
    var allOn = _whVisibleRows.length && _whVisibleRows.every(function(k) { return _stockDelSelected[k]; });
    act.classList.add('show');
    el('whCount').textContent = n ? 'เลือกลบ ' + n + ' รายการ' : 'ยังไม่ได้เลือก';
    el('whSelAllBtn').textContent = allOn ? 'ไม่เลือกทั้งหมด' : 'เลือกทั้งหมด (' + _whVisibleRows.length + ')';
    el('whSelAllBtn').disabled = !_whVisibleRows.length;
    el('whDelBtn').disabled = !n;
    return;
  }
  var rows = Object.keys(_stockSelected).filter(function(k) { return _stockSelected[k]; });
  var pcs = 0;
  rows.forEach(function(k) { var p = stockCache.find(function(x) { return String(x.rowIndex) === k; }); if (p) pcs += whChosenPieces(p); });
  act.classList.toggle('show', rows.length > 0);
  el('whCount').textContent = 'เลือก ' + rows.length + ' รายการ · ' + pcs + ' ชิ้น';
}

// Items with stock first; sold-out ones sink to the bottom
function stockAvailabilityRank(p) { return whSoldOut(p) ? 1 : 0; }

function renderStockCards(container, query) {
  if (!container) return;
  container.innerHTML = '';
  var filtered = stockCache.filter(function(p) {
    if (!query) return true;
    var hay = (p.name + ' ' + p.id + ' ' + (p.children || []).map(function(c) { return c.name + ' ' + c.id; }).join(' ')).toLowerCase();
    return hay.indexOf(query) !== -1;
  }).slice().sort(function(a, b) { return stockAvailabilityRank(a) - stockAvailabilityRank(b); });
  _whVisibleRows = filtered.map(function(p) { return String(p.rowIndex); });

  if (!filtered.length) {
    container.appendChild(div('wh-empty', query ? 'ไม่พบสินค้าที่ค้นหา' : 'ยังไม่มีสินค้าในคลัง'));
    refreshStockPushBar(); return;
  }

  filtered.forEach(function(p) {
    var hasKids = !!(p.children && p.children.length);
    var sel = !!(_whDelMode ? _stockDelSelected : _stockSelected)[p.rowIndex], soldOut = whSoldOut(p), stockNow = whStockOf(p);
    var card = div('wcard' + (sel ? ' selected' : '') + (soldOut ? ' sold-out' : '') + (_whDelMode ? ' del' : ''));
    card.setAttribute('data-row', p.rowIndex);
    card.setAttribute('role', 'button'); card.tabIndex = 0;
    card.setAttribute('aria-pressed', sel ? 'true' : 'false');
    card.setAttribute('aria-label', _whDelMode ? 'เลือกลบ ' + p.name : (hasKids ? 'เลือกแบบของ ' : 'เลือก ') + p.name);

    var img = div('wcard-img');
    if (p.image) { var im = document.createElement('img'); im.src = p.image; im.alt = ''; im.loading = 'lazy'; img.appendChild(im); }
    else img.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    img.appendChild(div('wcard-check', sel ? '&#x2713;' : ''));
    if (p.status !== 'Open') img.appendChild(div('wcard-tag closed', 'ปิด'));
    if (whInTarget(p)) img.appendChild(div('wcard-tag inlist', 'อยู่ในรายการแล้ว'));
    if (soldOut) img.appendChild(div('wcard-tag out', 'หมด'));
    card.appendChild(img);

    var body = div('wcard-body');
    var nm = div('wcard-name'); nm.textContent = p.name; nm.title = p.name; body.appendChild(nm);
    var meta = [baht(p.price)];
    if (hasKids) meta.push(p.children.length + ' แบบ');
    meta.push(stockNow === null ? '∞' : 'เหลือ ' + stockNow);
    body.appendChild(div('wcard-meta', escapeHtml(meta.join(' · '))));

    var foot = div('wcard-foot');
    if (_whDelMode) {
      body.appendChild(foot); card.appendChild(body); container.appendChild(card);
      return;
    }
    if (hasKids) {
      var m = _stockVariantQty[p.rowIndex] || {}, nKinds = Object.keys(m).length;
      var pick = makeBtn('wcard-pick' + (sel ? ' on' : ''), sel ? 'เลือก ' + nKinds + ' แบบ · ' + whChosenPieces(p) + ' ชิ้น' : 'เลือกแบบ &#x203A;');
      pick.type = 'button'; pick.setAttribute('data-act', 'pick');
      foot.appendChild(pick);
    } else if (sel && stockNow !== null) {
      var max = Math.max(1, stockNow);
      var st = div('pcard-stepper');
      [-1, 0, 1].forEach(function(d) {
        if (!d) {
          var qi = document.createElement('input'); qi.type = 'number'; qi.min = '1'; qi.max = String(max); qi.inputMode = 'numeric';
          qi.className = 'stock-input wcard-qty'; qi.value = _stockQtyMap[p.rowIndex] || 1; qi.setAttribute('data-act', 'qty');
          qi.setAttribute('aria-label', 'จำนวนที่นำเข้า ' + p.name);
          st.appendChild(qi); return;
        }
        var b = makeBtn('pstep', d > 0 ? '+' : '&#x2212;'); b.type = 'button'; b.setAttribute('data-act', d > 0 ? 'inc' : 'dec');
        b.setAttribute('aria-label', d > 0 ? 'เพิ่มจำนวน' : 'ลดจำนวน');
        st.appendChild(b);
      });
      foot.appendChild(st);
    } else {
      foot.appendChild(div('wcard-note', stockNow === null ? (sel ? '∞ นำเข้าแบบไม่จำกัด' : '∞ ไม่จำกัด') : ''));
    }
    var eb = makeBtn('btn-icon wcard-edit', SVG_EDIT); eb.type = 'button'; eb.setAttribute('data-act', 'edit'); eb.setAttribute('aria-label', 'แก้ไข ' + p.name);
    foot.appendChild(eb);
    body.appendChild(foot);
    card.appendChild(body);
    container.appendChild(card);
  });

  // One delegated handler for all cards
  container.onclick = function(e) {
    var card = e.target.closest('.wcard'); if (!card) return;
    var p = stockCache.find(function(x) { return String(x.rowIndex) === card.getAttribute('data-row'); }); if (!p) return;
    if (_whDelMode) {
      if (_stockDelSelected[p.rowIndex]) delete _stockDelSelected[p.rowIndex]; else _stockDelSelected[p.rowIndex] = true;
      whRerender(); return;
    }
    var actEl = e.target.closest('[data-act]'), act = actEl && actEl.getAttribute('data-act');
    if (act === 'edit') { openEditStockModal(p); return; }
    if (act === 'qty') return;
    if (act === 'inc' || act === 'dec') { whSetQty(p, (_stockQtyMap[p.rowIndex] || 1) + (act === 'inc' ? 1 : -1)); return; }
    whToggle(p);
  };
  container.onkeydown = function(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('wcard')) { e.preventDefault(); e.target.click(); }
  };
  container.onchange = function(e) {
    if (e.target.getAttribute('data-act') !== 'qty') return;
    var p = stockCache.find(function(x) { return String(x.rowIndex) === e.target.closest('.wcard').getAttribute('data-row'); });
    if (p) whSetQty(p, e.target.value);
  };
  refreshStockPushBar();
}

function whRerender() { renderStockCards(el('stockCardGrid'), stockSearchQuery); }

function whSetQty(p, v) {
  var max = whStockOf(p);
  v = Math.floor(Number(v)); if (!(v >= 1)) v = 1;
  if (max !== null && v > max) { v = max; toast('มีในคลัง ' + max + ' ชิ้น', 'error'); }
  _stockQtyMap[p.rowIndex] = v;
  whRerender();
}

// Tap a card: singles toggle (default = everything in stock); variants open the picker
function whToggle(p) {
  if (p.children && p.children.length) { openVariantPicker(p); return; }
  if (whSoldOut(p)) { toast('สินค้าหมด — เพิ่มสต็อกก่อนนำเข้า', 'error'); return; }
  if (_stockSelected[p.rowIndex]) { delete _stockSelected[p.rowIndex]; delete _stockQtyMap[p.rowIndex]; }
  else { _stockSelected[p.rowIndex] = true; var s = whStockOf(p); _stockQtyMap[p.rowIndex] = s === null ? 1 : Math.max(1, s); }
  whRerender();
}

// ── Variant picker: how many of each variant go into the list ──
function openVariantPicker(p) {
  var cur = _stockVariantQty[p.rowIndex];
  var draft = {};
  p.children.forEach(function(c) {
    if (cur) { if (cur[c.rowIndex]) draft[c.rowIndex] = cur[c.rowIndex]; }
    else if (!isTrackedStock(c.stock)) draft[c.rowIndex] = 1;                  // ∞ variants included
    else if (Number(c.stock) > 0) draft[c.rowIndex] = Number(c.stock);         // default: everything in stock
  });

  el('modalBody').innerHTML = '';
  var box = div('vp');
  if (whInTarget(p)) box.appendChild(div('vp-note', 'สินค้านี้อยู่ในรายการแล้ว — จำนวนที่เลือกจะถูกเพิ่มเข้าไปในสินค้าเดิม'));
  var tools = div('vp-tools');
  tools.appendChild(makeBtn('btn btn-ghost btn-sm', 'เลือกทั้งหมด', function() {
    p.children.forEach(function(c) { if (!isTrackedStock(c.stock)) draft[c.rowIndex] = 1; else if (Number(c.stock) > 0) draft[c.rowIndex] = Number(c.stock); });
    drawRows();
  }));
  tools.appendChild(makeBtn('btn btn-ghost btn-sm', 'ล้าง', function() { draft = {}; drawRows(); }));
  box.appendChild(tools);
  var list = div('vp-list'); box.appendChild(list);
  el('modalBody').appendChild(box);

  function drawRows() {
    list.innerHTML = '';
    p.children.forEach(function(c) {
      var tracked = isTrackedStock(c.stock), have = tracked ? Number(c.stock) : null, out = tracked && have <= 0;
      var row = div('vp-row' + (out ? ' out' : '') + (draft[c.rowIndex] ? ' on' : ''));
      var th = div('ep-vthumb'); if (c.image) { var im = document.createElement('img'); im.src = c.image; im.alt = ''; im.loading = 'lazy'; th.appendChild(im); }
      row.appendChild(th);
      var info = div('vp-info');
      var n = div('ep-vname'); n.textContent = c.name; info.appendChild(n);
      info.appendChild(div('vp-have', out ? 'หมด' : tracked ? 'มี ' + have + ' ชิ้น' : '∞ ไม่จำกัด'));
      row.appendChild(info);
      if (out) { row.appendChild(div('vp-skip', 'ข้าม')); }
      else if (!tracked) {
        var lab = document.createElement('label'); lab.className = 'vp-inc';
        var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!draft[c.rowIndex];
        cb.onchange = function() { if (cb.checked) draft[c.rowIndex] = 1; else delete draft[c.rowIndex]; row.classList.toggle('on', cb.checked); };
        lab.appendChild(cb); lab.appendChild(document.createTextNode(' นำเข้า'));
        row.appendChild(lab);
      } else {
        var st = div('pcard-stepper');
        var qi = document.createElement('input'); qi.type = 'number'; qi.min = '0'; qi.max = String(have); qi.inputMode = 'numeric';
        qi.className = 'stock-input'; qi.value = draft[c.rowIndex] || 0; qi.setAttribute('aria-label', 'จำนวน ' + c.name);
        function set(v) {
          v = Math.max(0, Math.min(have, Math.floor(Number(v)) || 0));
          if (v) draft[c.rowIndex] = v; else delete draft[c.rowIndex];
          qi.value = v; row.classList.toggle('on', v > 0);
        }
        var mi = makeBtn('pstep', '&#x2212;'); mi.type = 'button'; mi.setAttribute('aria-label', 'ลด ' + c.name); mi.onclick = function() { set((draft[c.rowIndex] || 0) - 1); };
        var pl = makeBtn('pstep', '+'); pl.type = 'button'; pl.setAttribute('aria-label', 'เพิ่ม ' + c.name); pl.onclick = function() { set((draft[c.rowIndex] || 0) + 1); };
        qi.onchange = function() { set(qi.value); };
        st.appendChild(mi); st.appendChild(qi); st.appendChild(pl);
        row.appendChild(st);
      }
      list.appendChild(row);
    });
  }
  drawRows();

  openModal('เลือกแบบ: ' + escapeHtml(p.name), '', function() {
    if (Object.keys(draft).length) { _stockVariantQty[p.rowIndex] = draft; _stockSelected[p.rowIndex] = true; }
    else { delete _stockVariantQty[p.rowIndex]; delete _stockSelected[p.rowIndex]; }
    closeModal(); whRerender();
  }, 'ตกลง');
}

// ── Scan to select: every scan picks the matching item (+1 each time);
// an unknown barcode offers to create the product ──
function whPickByCode(code) {
  code = String(code || '').trim(); if (!code) return;
  var key = code.toLowerCase(), parent = null, child = null;
  stockCache.some(function(p) {
    if (String(p.id || '').toLowerCase() === key && !(p.children && p.children.length)) { parent = p; return true; }
    var c = (p.children || []).find(function(x) { return String(x.id || '').toLowerCase() === key; });
    if (c) { parent = p; child = c; return true; }
    return false;
  });
  if (!parent) {
    el('modalBody').innerHTML = '';
    var msg = div('wh-notfound');
    msg.innerHTML = 'ไม่พบบาร์โค้ด <strong></strong> ในคลัง';
    msg.querySelector('strong').textContent = code;
    el('modalBody').appendChild(msg);
    openModal('ไม่พบสินค้า', '', function() { closeModal(); openCreateStockForm(code); }, 'เพิ่มสินค้าใหม่ด้วยบาร์โค้ดนี้');
    return;
  }
  if (child) {
    var have = isTrackedStock(child.stock) ? Number(child.stock) : null;
    var m = _stockVariantQty[parent.rowIndex] || (_stockVariantQty[parent.rowIndex] = {});
    if (have === null) m[child.rowIndex] = 1;
    else if ((m[child.rowIndex] || 0) >= have) { toast(child.name + ': มีในคลัง ' + have + ' ชิ้น', 'error'); return; }
    else m[child.rowIndex] = (m[child.rowIndex] || 0) + 1;
    _stockSelected[parent.rowIndex] = true;
    toast('เลือก ' + parent.name + ' — ' + child.name + (have === null ? '' : ' (' + m[child.rowIndex] + ')'), 'success');
  } else {
    var s = whStockOf(parent);
    if (s !== null && s <= 0) { toast(parent.name + ': สินค้าหมด', 'error'); return; }
    var q = _stockSelected[parent.rowIndex] ? (_stockQtyMap[parent.rowIndex] || 1) + 1 : 1;
    if (s !== null && q > s) { toast(parent.name + ': มีในคลัง ' + s + ' ชิ้น', 'error'); return; }
    _stockSelected[parent.rowIndex] = true; _stockQtyMap[parent.rowIndex] = q;
    toast('เลือก ' + parent.name + ' (' + q + ')', 'success');
  }
  whRerender();
}
function whScanLoop() {
  var tok = 'wh_' + Date.now();
  var pop = window.open('', 'wh_scan', 'width=420,height=600,resizable=yes');
  if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
  var bridge = function(t, code) { if (t === tok) whPickByCode(code); };
  window.__barcodeResultBridge = bridge;
  pop.document.open(); pop.document.write(makeScannerPopupHtml(tok, true)); pop.document.close();
  var ck = setInterval(function() {
    if (!pop || pop.closed) { clearInterval(ck); if (window.__barcodeResultBridge === bridge) delete window.__barcodeResultBridge; }
  }, 500);
}

function pushSelectedToShop(targetSheetId) {
  if (!targetSheetId) {
    toast('เลือกรายการปลายทางด้านบนก่อน', 'error');
    var t = document.querySelector('.wh-target'); if (t) { t.classList.add('need'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    return;
  }
  var items = [];
  Object.keys(_stockSelected).forEach(function(k) {
    if (!_stockSelected[k]) return;
    var p = stockCache.find(function(x) { return String(x.rowIndex) === k; }); if (!p) return;
    if (p.children && p.children.length) items.push({ parentRowIndex: p.rowIndex, childQty: _stockVariantQty[p.rowIndex] || {} });
    else items.push({ parentRowIndex: p.rowIndex, qty: _stockQtyMap[p.rowIndex] || 1 });
  });
  if (!items.length) { toast('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ', 'error'); return; }
  var listName = (getVisibleLists().find(function(l) { return l.sheetId === targetSheetId; }) || {}).name || '';
  var btn = el('stockPushBtn'); if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า...'; }
  function done() { if (btn) { btn.disabled = false; btn.innerHTML = 'นำเข้า &#x2192;'; } }
  google.script.run.withSuccessHandler(function(r) {
    done();
    var res; try { res = JSON.parse(r); } catch (e) { toast('เกิดข้อผิดพลาด', 'error'); return; }
    if (res.status !== 'Success') { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return; }
    _stockSelected = {}; _stockQtyMap = {}; _stockVariantQty = {};
    var msg = 'นำเข้า ' + listName + ' แล้ว ' + res.pushed + ' รายการ' + (res.merged ? ' (เพิ่มสต็อกของเดิม ' + res.merged + ')' : '');
    toast(msg, 'success', { label: 'ดูรายการ →', onClick: function() {
      selectedSheetId = targetSheetId; selectedSheetName = listName; currentProductsSheetId = targetSheetId; switchPanel('products');
    } });
    loadStock(renderStockContent);
  }).withFailureHandler(function(error) {
    done(); toast(error && error.message ? error.message : 'นำสินค้าเข้าไม่สำเร็จ', 'error');
  }).adminPushStockToShop(targetSheetId, items);
}

// Scanned an item that already exists: "+ add stock" with one number, plus a
// way into the full editor. Unlimited (∞) items have nothing to add to.
// freshStock: the count the barcode lookup just read from the database (the
// cached list can be stale) — the new total is built on that
function openQuickRestock(parent, child, freshStock) {
  var target = child || parent;
  var full = function() { closeModal(); if (child) openEditStockChildModal(child, parent); else openEditStockModal(parent); };
  if (!isTrackedStock(target.stock)) { toast('พบสินค้าแล้ว (สต็อกไม่จำกัด) — เปิดหน้าแก้ไข', 'success'); full(); return; }
  var have = Number(freshStock !== undefined && freshStock !== null ? freshStock : target.stock) || 0;

  el('modalBody').innerHTML = '';
  var box = div('epform');
  var head = div('qr-head');
  var th = div('ep-vthumb'); var src = target.image || parent.image;
  if (src) { var im = document.createElement('img'); im.src = src; im.alt = ''; th.appendChild(im); }
  head.appendChild(th);
  var info = div('vp-info');
  var nm = div('ep-vname'); nm.textContent = child ? parent.name + ' — ' + child.name : parent.name; info.appendChild(nm);
  info.appendChild(div('vp-have', 'มีในคลัง ' + have + ' ชิ้น'));
  head.appendChild(info);
  box.appendChild(head);

  var add = fkInput('qrAdd', 'number', 1, '0'); add.min = '1'; add.inputMode = 'numeric'; add.classList.add('ep-stock');
  var st = div('pcard-stepper');
  var mi = makeBtn('pstep', '&#x2212;'); mi.type = 'button'; mi.setAttribute('aria-label', 'ลด');
  var pl = makeBtn('pstep', '+'); pl.type = 'button'; pl.setAttribute('aria-label', 'เพิ่ม');
  var after = div('qr-after');
  function upd(v) { v = Math.max(1, Math.floor(Number(v)) || 1); add.value = v; after.textContent = 'หลังเพิ่ม: ' + (have + v) + ' ชิ้น'; }
  mi.onclick = function() { upd(Number(add.value) - 1); }; pl.onclick = function() { upd(Number(add.value) + 1); };
  add.oninput = function() { after.textContent = 'หลังเพิ่ม: ' + (have + (Math.floor(Number(add.value)) || 0)) + ' ชิ้น'; };
  st.appendChild(mi); st.appendChild(add); st.appendChild(pl);
  box.appendChild(fkField('เพิ่มสต็อก', st, 'qrAdd'));
  box.appendChild(after); upd(1);
  el('modalBody').appendChild(box);

  openModal('พบสินค้านี้ในคลังแล้ว', '', function() {
    var n = Math.floor(Number(add.value));
    if (!(n >= 1)) { toast('จำนวนต้องมากกว่า 0', 'error'); return; }
    var sb = el('modalSave'); sb.disabled = true; sb.textContent = 'กำลังบันทึก...';
    google.script.run.withSuccessHandler(function(r) {
      var res; try { res = JSON.parse(r); } catch (e) { res = {}; }
      if (res.status !== 'Success') { sb.disabled = false; sb.textContent = 'เพิ่มสต็อก'; toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return; }
      closeModal(); toast('เพิ่มสต็อกแล้ว — ตอนนี้มี ' + (have + n) + ' ชิ้น', 'success'); loadStock(renderStockContent);
    }).withFailureHandler(function() { sb.disabled = false; sb.textContent = 'เพิ่มสต็อก'; toast('เพิ่มสต็อกไม่สำเร็จ', 'error'); })
      .adminUpdateStockRow(child ? child.rowIndex : parent.rowIndex, child ? 1 : 0,
        target.id, target.name, (child ? child.image || parent.image : parent.image) || '',
        parent.price, parent.deposit, parent.yuan, have + n, parent.status);
  }, 'เพิ่มสต็อก');
  var other = el('modalSaveNext');
  other.hidden = false; other.textContent = 'แก้ไขข้อมูลสินค้า'; other.onclick = full;
}

function openMatchedStockEditor(item, refreshed) {
  item = item || {};
  var parent = null, child = null;
  if (item.isOption) {
    parent = stockCache.find(function(p) {
      return p.stockItemId === item.parentId || (p.children || []).some(function(c) { return c.stockItemId === item.id; });
    });
    if (parent) {
      child = (parent.children || []).find(function(c) {
        return c.stockItemId === item.id || String(c.id || '').trim().toLowerCase() === String(item.code || '').trim().toLowerCase();
      });
    }
  } else {
    parent = stockCache.find(function(p) {
      return p.stockItemId === item.id || String(p.id || '').trim().toLowerCase() === String(item.code || '').trim().toLowerCase();
    });
  }

  // Already in the warehouse → the usual reason to scan it is new stock arriving
  if (item.isOption && parent && child) { openQuickRestock(parent, child, item.stock); return; }
  if (!item.isOption && parent) {
    if (parent.children && parent.children.length) { openEditStockModal(parent); return; }
    openQuickRestock(parent, null, item.stock);
    return;
  }
  if (!refreshed) {
    loadStock(function() { openMatchedStockEditor(item, true); });
    return;
  }
  toast('พบสินค้า แต่เปิดหน้าแก้ไขไม่สำเร็จ — กรุณารีเฟรชคลัง', 'error');
}

// ── Create Stock Product — barcode-first duplicate check ──
// defaults: prices carried over from "บันทึก + เพิ่มต่อ"
function openCreateStockModal(defaults) {
  el('modalBody').innerHTML = '';

  var intro = document.createElement('div');
  intro.style.cssText = 'font-size:0.82rem;color:var(--text-2);line-height:1.6;margin-bottom:14px;';
  intro.textContent = 'สแกนหรือกรอกบาร์โค้ดก่อน ระบบจะตรวจสอบว่าสินค้านี้มีอยู่ในคลังแล้วหรือยัง';
  el('modalBody').appendChild(intro);

  var group = document.createElement('div'); group.className = 'sf-group stock-barcode-lookup';
  var label = document.createElement('label'); label.htmlFor = 'stockLookupBarcode'; label.textContent = 'บาร์โค้ดสินค้า *';
  var row = document.createElement('div'); row.className = 'sf-bc-row';
  var input = document.createElement('input');
  input.id = 'stockLookupBarcode'; input.type = 'text'; input.placeholder = 'สแกนหรือพิมพ์บาร์โค้ด';
  input.autocomplete = 'off'; input.inputMode = 'numeric';

  var scanBtn = document.createElement('button'); scanBtn.type = 'button'; scanBtn.className = 'sf-bc-btn cam';
  scanBtn.innerHTML = '📷'; scanBtn.title = 'สแกนบาร์โค้ด';
  var randomBtn = document.createElement('button'); randomBtn.type = 'button'; randomBtn.className = 'sf-bc-btn';
  randomBtn.innerHTML = '🎲 สุ่ม';
  randomBtn.onclick = function() { input.value = generateRandomBarcode(); input.focus(); };

  row.appendChild(input); row.appendChild(scanBtn); row.appendChild(randomBtn);
  group.appendChild(label); group.appendChild(row); el('modalBody').appendChild(group);

  function runLookup() {
    var barcode = input.value.trim();
    if (!barcode) { toast('กรุณากรอกบาร์โค้ด', 'error'); input.focus(); return; }
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังตรวจสอบ...';
    google.script.run.withSuccessHandler(function(r) {
      saveBtn.disabled = false; saveBtn.textContent = 'ตรวจสอบบาร์โค้ด';
      try {
        var res = JSON.parse(r);
        if (res.status !== 'Success') { toast(res.message || 'ตรวจสอบบาร์โค้ดไม่สำเร็จ', 'error'); return; }
        if (res.found) { openMatchedStockEditor(res.item || {}, false); return; }
        openCreateStockForm(barcode, defaults);
      } catch (e) { toast('ตรวจสอบบาร์โค้ดไม่สำเร็จ', 'error'); }
    }).withFailureHandler(function() {
      saveBtn.disabled = false; saveBtn.textContent = 'ตรวจสอบบาร์โค้ด';
      toast('ตรวจสอบบาร์โค้ดไม่สำเร็จ', 'error');
    }).adminFindStockByBarcode(barcode);
  }

  input.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); runLookup(); } };
  scanBtn.onclick = function() {
    var tok = 'stock_lookup_' + Date.now();
    var pop = window.open('', 'stock_lookup_scan', 'width=420,height=600,resizable=yes');
    if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
    scanBtn.disabled = true; scanBtn.innerHTML = '⏹';
    function resetScan() { scanBtn.disabled = false; scanBtn.innerHTML = '📷'; }
    function applyResult(value) {
      input.value = String(value || '').trim(); resetScan();
      if (input.value) runLookup();
    }
    window.__barcodeResultBridge = function(t, barcode) {
      if (t !== tok) return;
      delete window.__barcodeResultBridge; applyResult(barcode);
      try { if (pop && !pop.closed) pop.close(); } catch (e) {}
    };
    pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
    var checkPopup = setInterval(function() {
      try {
        if (pop && !pop.closed && pop.__barcodeResult) {
          var value = pop.__barcodeResult; clearInterval(checkPopup); delete window.__barcodeResultBridge;
          applyResult(value); pop.close(); return;
        }
        if (!pop || pop.closed) { clearInterval(checkPopup); delete window.__barcodeResultBridge; resetScan(); }
      } catch (e) { clearInterval(checkPopup); resetScan(); }
    }, 250);
  };

  openModal('🔎 เพิ่มสินค้าด้วยบาร์โค้ด', '', runLookup, 'ตรวจสอบบาร์โค้ด');
  setTimeout(function() { input.focus(); }, 50);
}

// ── Create Stock Product Form (shared draft across single/options modes) ──
function openCreateStockForm(prefillBarcode, defaults) {
  el('modalBody').innerHTML = '';
  var isOptionsMode = false; // toggle state
  var addNext = false;       // set by the "บันทึก + เพิ่มต่อ" button
  defaults = defaults || {};
  var draft = {
    name: '', price: defaults.price || '', deposit: defaults.deposit || '', yuan: defaults.yuan || '', image: '',
    singleId: String(prefillBarcode || '').trim(), singleStock: '',
    options: []
  };

  function captureDraft() {
    if (el('spName')) draft.name = el('spName').value;
    if (el('spPrice')) draft.price = el('spPrice').value;
    if (el('spDeposit')) draft.deposit = el('spDeposit').value;
    if (el('spYuan')) draft.yuan = el('spYuan').value;
    if (el('spImage')) draft.image = el('spImage').value;
    if (isOptionsMode) {
      draft.options = collectOptionRows('spOptSection');
    } else {
      if (el('spId')) draft.singleId = el('spId').value;
      if (el('spStock')) draft.singleStock = el('spStock').value;
    }
  }

  function buildForm() {
    el('modalBody').innerHTML = '';

    // ── Mode toggle ──
    var toggleWrap = document.createElement('div');
    toggleWrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:20px;';
    var tog = document.createElement('div'); tog.className = 'mode-toggle';
    function makeModeBtn(emoji, label, mode) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'mode-toggle-btn' + (isOptionsMode === (mode === 'options') ? ' active' : '');
      b.innerHTML = emoji + ' ' + label;
      b.onclick = function() {
        var nextOptionsMode = mode === 'options';
        if (isOptionsMode === nextOptionsMode) return;
        captureDraft();
        if (nextOptionsMode && !draft.options.length) {
          draft.options = [{ id: draft.singleId, name: '', stock: draft.singleStock, image: '' }];
        } else if (!nextOptionsMode && !draft.singleId && draft.options.length) {
          draft.singleId = draft.options[0].id || '';
          draft.singleStock = draft.options[0].stock || '';
        }
        isOptionsMode = nextOptionsMode;
        buildForm();
      };
      return b;
    }
    tog.appendChild(makeModeBtn('🏷', 'สินค้าเดียว', 'single'));
    tog.appendChild(makeModeBtn('🎨', 'มีตัวเลือก', 'options'));
    toggleWrap.appendChild(tog);
    el('modalBody').appendChild(toggleWrap);

    // ── Main fields ──
    var grid = document.createElement('div'); grid.className = 'sf-grid';
    el('modalBody').appendChild(grid);

    function sfField(id, label, type, placeholder, full, val) {
      var g = document.createElement('div');
      g.className = 'sf-group' + (full ? ' sf-full' : '');
      var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
      var i = document.createElement('input'); i.id = id; i.type = type || 'text';
      if (placeholder) i.placeholder = placeholder;
      if (val !== undefined) i.value = val;
      g.appendChild(l); g.appendChild(i); grid.appendChild(g); return i;
    }

    sfField('spName', 'ชื่อสินค้า *', 'text', 'เช่น Acrylic Stand A', true, draft.name);

    // Price: one-tap common prices + the price box on one line
    var priceGrp = document.createElement('div'); priceGrp.className = 'sf-group sf-full';
    var priceLbl = document.createElement('label'); priceLbl.htmlFor = 'spPrice'; priceLbl.textContent = 'ราคาเต็ม (฿)';
    var priceInp = document.createElement('input'); priceInp.id = 'spPrice'; priceInp.value = draft.price;
    priceGrp.appendChild(priceLbl); priceGrp.appendChild(makePriceChips(priceInp)); grid.appendChild(priceGrp);
    sfField('spDeposit', 'ราคามัดจำ (฿)', 'number', '0', false, draft.deposit);
    sfField('spYuan',    'ราคาหยวน (¥)',  'number', '0', false, draft.yuan);

    if (!isOptionsMode) {
      // Stock only shown for single product (options track their own stock)
      sfField('spStock', 'สต็อก', 'number', 'ว่าง = ไม่จำกัด', false, draft.singleStock);
      // Barcode for single product
      var bcGroup = document.createElement('div'); bcGroup.className = 'sf-group sf-full';
      var bcLbl = document.createElement('label'); bcLbl.textContent = 'ID / บาร์โค้ด *';
      var bcRow = document.createElement('div'); bcRow.className = 'sf-bc-row';
      var bcInp = document.createElement('input'); bcInp.id = 'spId'; bcInp.type = 'text'; bcInp.placeholder = 'สแกนหรือกรอกบาร์โค้ด';
      bcInp.value = draft.singleId;

      var camBc = document.createElement('button'); camBc.type = 'button'; camBc.className = 'sf-bc-btn cam';
      camBc.innerHTML = '📷';
      camBc.onclick = function() {
        var tok = 'sp_bc_' + Date.now();
        var pop = window.open('', 'sp_bc_scan', 'width=420,height=600,resizable=yes');
        if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
        window.__barcodeResultBridge = function(t, bc) {
          if (t !== tok) return; bcInp.value = bc; delete window.__barcodeResultBridge;
          try { if (pop && !pop.closed) pop.close(); } catch(e) {}
        };
        pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
        var chk = setInterval(function() {
          try {
            if (pop && !pop.closed && pop.__barcodeResult) { var rv = pop.__barcodeResult; clearInterval(chk); delete window.__barcodeResultBridge; bcInp.value = rv; pop.close(); }
            if (!pop || pop.closed) { clearInterval(chk); delete window.__barcodeResultBridge; }
          } catch(ex) { clearInterval(chk); }
        }, 250);
      };
      var randBc = document.createElement('button'); randBc.type = 'button'; randBc.className = 'sf-bc-btn';
      randBc.innerHTML = '🎲 สุ่ม';
      randBc.onclick = function() { bcInp.value = generateRandomBarcode(); };

      bcRow.appendChild(bcInp); bcRow.appendChild(camBc); bcRow.appendChild(randBc);
      bcGroup.appendChild(bcLbl); bcGroup.appendChild(bcRow); grid.appendChild(bcGroup);
    }

    // ── Image field — same shared component as the edit modal, so
    // add and edit look identical (tap = camera/gallery, paste, URL) ──
    var imgGroup = document.createElement('div'); imgGroup.className = 'sf-group sf-full';
    imgGroup.appendChild(makeImageField('spImage', draft.image, 'รูปภาพสินค้า'));
    var aiBtn = document.createElement('button'); aiBtn.type = 'button'; aiBtn.className = 'bulk-ai-btn';
    aiBtn.style.marginTop = '8px'; aiBtn.textContent = '✨ AI ตั้งชื่อจากรูป';
    aiBtn.onclick = function() { aiFillFromImageField('spImage', 'spName', aiBtn); };
    imgGroup.appendChild(aiBtn);
    grid.appendChild(imgGroup);
    if (pendingImg.spImage) applyImgData(pendingImg.spImage, 'spImage');

    // ── Options section ──
    if (isOptionsMode) {
      var hr = document.createElement('hr'); hr.className = 'sf-section-divider sf-full'; grid.appendChild(hr);

      var optHdr = document.createElement('div'); optHdr.className = 'sf-full';
      optHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
      var optTitle = document.createElement('div');
      optTitle.style.cssText = 'font-size:0.78rem;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:0.06em;';
      optTitle.textContent = 'ตัวเลือกสินค้า';
      var optCount = document.createElement('span');
      optCount.id = 'spOptCount';
      optCount.style.cssText = 'font-size:0.7rem;color:var(--text-3);font-weight:600;';
      optCount.textContent = '0 ตัวเลือก';
      optHdr.appendChild(optTitle); optHdr.appendChild(optCount);
      grid.appendChild(optHdr);

      var optSection = div('sf-full');
      optSection.id = 'spOptSection';
      optSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
      grid.appendChild(optSection);
      renderOptionRows('spOptSection', draft.options);
      optCount.textContent = draft.options.length + ' ตัวเลือก';

      var addOptBtn2 = document.createElement('button');
      addOptBtn2.type = 'button'; addOptBtn2.className = 'add-opt-btn sf-full';
      addOptBtn2.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> เพิ่มตัวเลือก';
      addOptBtn2.onclick = function() {
        var cur = collectOptionRows('spOptSection');
        renderOptionRows('spOptSection', cur);
        addNewOptionRow('spOptSection', cur.length, '');
        var cnt = document.getElementById('spOptCount');
        if (cnt) cnt.textContent = (cur.length + 1) + ' ตัวเลือก';
      };
      grid.appendChild(addOptBtn2);
    }
  }

  buildForm();

  openModal('&#x2B; เพิ่มสินค้าในคลัง', '', function() {
    var wantNext = addNext; addNext = false; // per click
    captureDraft();
    var name = el('spName') && el('spName').value.trim();
    if (!name) { toast('กรุณากรอกชื่อสินค้า', 'error'); return; }

    var product = {
      name:    name,
      image:   '',
      price:   el('spPrice') ? el('spPrice').value : 0,
      deposit: el('spDeposit') ? el('spDeposit').value : 0,
      yuan:    el('spYuan') ? el('spYuan').value : 0,
      status:  'Open'
    };

    var options = [];
    if (!isOptionsMode) {
      product.id    = el('spId') ? el('spId').value.trim() : '';
      product.stock = el('spStock') ? el('spStock').value : '';
      if (!product.id) { toast('กรุณากรอก ID สินค้า', 'error'); return; }
    } else {
      product.id    = '';
      product.stock = el('spStock') ? el('spStock').value : '';
      options = collectOptionRows('spOptSection');
      if (!options.length) { toast('กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการ', 'error'); return; }
    }

    var saveBtn3 = el('modalSave'); saveBtn3.disabled = true; el('modalSaveNext').disabled = true; saveBtn3.textContent = 'กำลังบันทึก...';
    resolveImage('spImage', function(imgUrl) {
      product.image = imgUrl || '';
      resolveAllOptionImages(options, function(resolvedOpts) {
        google.script.run.withSuccessHandler(function(r) {
          saveBtn3.disabled = false; el('modalSaveNext').disabled = false; saveBtn3.textContent = 'เพิ่มสินค้า';
          try {
            var res = JSON.parse(r);
            if (res.status === 'Success') {
              toast('เพิ่มสินค้าในคลังแล้ว!', 'success'); loadStock(renderStockContent);
              closeModal();
              if (wantNext) openCreateStockModal({ price: product.price, deposit: product.deposit, yuan: product.yuan });
            }
            else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
          } catch(e) {
            saveBtn3.disabled = false; el('modalSaveNext').disabled = false; saveBtn3.textContent = 'เพิ่มสินค้า';
            toast('เกิดข้อผิดพลาด', 'error');
          }
        }).adminCreateStockProduct(product, resolvedOpts);
      });
    });
  }, 'เพิ่มสินค้า');
  var saveNextBtn = el('modalSaveNext');
  saveNextBtn.hidden = false;
  saveNextBtn.onclick = function() { addNext = true; if (modalSaveFn) modalSaveFn(); };
  el('modal').classList.add('open');
}

// ── Option row rendering helpers ──
function generateStockBarcode(baseId) {
  // Generate a random base and end with 00
  if (baseId && baseId.trim()) {
    var b = baseId.trim(); return b;
  }
  var r = '';
  for (var x = 0; x < 10; x++) r += Math.floor(Math.random() * 10);
  return r + '00';
}

function nextOptionBarcode(currentBarcodes) {
  // Take last barcode, parse its suffix, increment by 1
  if (!currentBarcodes || !currentBarcodes.length) return generateStockBarcode('');
  var last = String(currentBarcodes[currentBarcodes.length - 1] || '');
  if (!last) return generateStockBarcode('');
  // Find trailing digits
  var m = last.match(/^(.*?)(\d+)$/);
  if (!m) return last + '01';
  var base2 = m[1], num2 = parseInt(m[2], 10);
  var nextNum = num2 + 1;
  var padLen  = m[2].length;
  var padded  = String(nextNum).padStart(padLen, '0');
  return base2 + padded;
}

function renderOptionRows(sectionId, existingOpts) {
  var section = el(sectionId); if (!section) return;
  var header = section.querySelector('.opt-section-hdr');
  // Preserve header if exists
  var rows = section.querySelectorAll('.opt-card');
  rows.forEach(function(r) { r.remove(); });
  existingOpts.forEach(function(opt, idx) {
    section.appendChild(makeOptionRow(sectionId, opt, idx));
  });
}

function addNewOptionRow(sectionId, currentCount, baseBarcode) {
  var section = el(sectionId); if (!section) return;
  // Collect current barcodes
  var existingRows = collectOptionRows(sectionId);
  var barcodes = existingRows.map(function(o) { return o.id; }).filter(Boolean);
  var newBarcode = nextOptionBarcode(barcodes.length ? barcodes : [baseBarcode ? baseBarcode + '00' : null].filter(Boolean));
  var newOpt = { id: newBarcode, name: '', stock: '' };
  section.appendChild(makeOptionRow(sectionId, newOpt, currentCount));
}

function makeOptionRow(sectionId, opt, idx) {
  var imgFieldId = 'opt_img_' + sectionId + '_' + idx;
  var num = idx + 1;
  var padded = num < 10 ? '0' + num : String(num);

  // ── Card shell ──
  var row = document.createElement('div');
  row.className = 'opt-card';
  row.setAttribute('data-img-field', imgFieldId);

  // ── Card header ──
  var hdr = document.createElement('div'); hdr.className = 'opt-card-header';
  var lbl = document.createElement('span'); lbl.className = 'opt-card-label opt-badge';
  lbl.textContent = 'ตัวเลือก ' + padded;
  var delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'opt-card-del';
  delBtn.innerHTML = '&times;';
  delBtn.onclick = function() {
    delete pendingImg[imgFieldId];
    row.remove();
    var remaining = el(sectionId).querySelectorAll('.opt-card');
    remaining.forEach(function(r, ni) {
      var b = r.querySelector('.opt-badge');
      if (b) b.textContent = 'ตัวเลือก ' + (ni + 1 < 10 ? '0' + (ni + 1) : ni + 1);
    });
    var cnt = document.getElementById('spOptCount');
    if (cnt) { var n = el(sectionId).querySelectorAll('.opt-card').length; cnt.textContent = n + ' ตัวเลือก'; }
  };
  hdr.appendChild(lbl); hdr.appendChild(delBtn); row.appendChild(hdr);

  // ── Card body ──
  var body = document.createElement('div'); body.className = 'opt-card-body';

  // Image + name row
  var imgRow = document.createElement('div'); imgRow.className = 'opt-card-img-row';

  // Image box
  var imgBox = document.createElement('div'); imgBox.className = 'opt-img-box';
  // Option rows are rebuilt when another option is added. A newly selected
  // file is still pending in memory and has no saved URL yet, so restore the
  // preview from pendingImg before falling back to the persisted URL.
  var previewSource = pendingImg[imgFieldId] || opt.image || '';

  var thumb = document.createElement('div');
  thumb.id = imgFieldId + '_thumb';
  thumb.className = 'opt-img-thumb' + (previewSource ? ' has-img' : '');

  var thumbImg = document.createElement('img');
  thumbImg.id = imgFieldId + '_preview';
  thumbImg.alt = 'option image';
  if (previewSource) { thumbImg.src = previewSource; }
  else { thumbImg.style.display = 'none'; }

  // placeholder icon when no image
  var placeholderIcon = document.createElement('div');
  placeholderIcon.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;';
  placeholderIcon.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style="font-size:0.6rem;color:var(--text-3);font-weight:600;">แตะเพื่อเพิ่ม</span>';
  if (previewSource) placeholderIcon.style.display = 'none';

  // File input for gallery
  var fileInpOpt = document.createElement('input');
  fileInpOpt.type = 'file'; fileInpOpt.accept = 'image/*';
  fileInpOpt.className = 'img-source-input';
  fileInpOpt.onclick = function(e) { e.stopPropagation(); };
  fileInpOpt.onchange = (function(fid, ti, pi, th) { return function() {
    var file = this.files && this.files[0]; if (!file) return;
    var rdr = new FileReader();
    rdr.onload = function(ev) {
      pendingImg[fid] = ev.target.result;
      ti.src = ev.target.result; ti.style.display = 'block'; pi.style.display = 'none';
      th.className = 'opt-img-thumb has-img';
      var ui = document.getElementById(fid + '_url');
      if (ui) ui.value = '';
    };
    rdr.readAsDataURL(file);
  }; })(imgFieldId, thumbImg, placeholderIcon, thumb);

  thumb.appendChild(placeholderIcon); thumb.appendChild(thumbImg); thumb.appendChild(fileInpOpt);
  imgBox.appendChild(thumb);

  var optionCamera = makeCameraCapture(function(file) {
    var rdr = new FileReader();
    rdr.onload = function(ev) {
      pendingImg[imgFieldId] = ev.target.result;
      thumbImg.src = ev.target.result; thumbImg.style.display = 'block'; placeholderIcon.style.display = 'none';
      thumb.className = 'opt-img-thumb has-img';
      var ui = document.getElementById(imgFieldId + '_url');
      if (ui) ui.value = '';
    };
    rdr.readAsDataURL(file);
  });
  imgBox.appendChild(optionCamera.input);
  bindImageActionPicker(thumb, optionCamera.input, fileInpOpt, function(url) {
    delete pendingImg[imgFieldId];
    thumbImg.src = url; thumbImg.style.display = 'block'; placeholderIcon.style.display = 'none';
    thumb.className = 'opt-img-thumb has-img';
    hiddenUrl.value = url;
  });

  // The thumbnail opens the app chooser; each action has its own file input.
  var hiddenUrl = document.createElement('input');
  hiddenUrl.type = 'hidden'; hiddenUrl.id = imgFieldId;
  hiddenUrl.className = 'opt-image-url-hidden';
  hiddenUrl.value = opt.image || '';
  imgBox.appendChild(hiddenUrl);

  // Name column (right of image)
  var nameCol = document.createElement('div'); nameCol.className = 'opt-name-col';
  var nameGrp = document.createElement('div'); nameGrp.className = 'sf-group';
  nameGrp.style.marginBottom = '0';
  var nameLbl = document.createElement('label'); nameLbl.textContent = 'ชื่อตัวเลือก';
  var nameInp = document.createElement('input'); nameInp.type = 'text'; nameInp.className = 'opt-name';
  nameInp.value = opt.name || ''; nameInp.placeholder = 'เช่น สีแดง, Size M';
  nameGrp.appendChild(nameLbl); nameGrp.appendChild(nameInp); nameCol.appendChild(nameGrp);

  imgRow.appendChild(imgBox); imgRow.appendChild(nameCol);
  body.appendChild(imgRow);

  // ── Barcode row ──
  var bcGrp = document.createElement('div'); bcGrp.className = 'sf-group'; bcGrp.style.marginTop = '10px';
  var bcLbl = document.createElement('label'); bcLbl.textContent = 'บาร์โค้ด';
  var bcRow = document.createElement('div'); bcRow.className = 'sf-bc-row';

  var bcInp = document.createElement('input'); bcInp.type = 'text'; bcInp.className = 'opt-barcode';
  bcInp.id = 'opt_bc_' + sectionId + '_' + idx;
  bcInp.value = opt.id || ''; bcInp.placeholder = 'สแกนหรือพิมพ์บาร์โค้ด';

  // Barcode scanner camera btn
  var bcScanBtn = document.createElement('button'); bcScanBtn.type = 'button'; bcScanBtn.className = 'sf-bc-btn cam';
  bcScanBtn.innerHTML = '📷';  bcScanBtn.title = 'สแกนบาร์โค้ด';
  bcScanBtn.onclick = (function(inp5) { return function() {
    var tok = 'optbc_' + Date.now();
    var pop = window.open('','optbc_s','width=420,height=600,resizable=yes');
    if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
    bcScanBtn.innerHTML = '⏹'; bcScanBtn.disabled = true;
    function rst() { bcScanBtn.innerHTML = '📷'; bcScanBtn.disabled = false; }
    window.__barcodeResultBridge = function(t, bc) {
      if (t !== tok) return; inp5.value = bc; delete window.__barcodeResultBridge; rst();
      try { if (pop && !pop.closed) pop.close(); } catch(ee) {}
    };
    pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
    var chk = setInterval(function() {
      try {
        if (pop && !pop.closed && pop.__barcodeResult) { var rv = pop.__barcodeResult; clearInterval(chk); delete window.__barcodeResultBridge; inp5.value = rv; rst(); pop.close(); return; }
        if (!pop || pop.closed) { clearInterval(chk); delete window.__barcodeResultBridge; rst(); }
      } catch(ee2) { clearInterval(chk); rst(); }
    }, 250);
  }; })(bcInp);

  // Random barcode
  var bcRandBtn = document.createElement('button'); bcRandBtn.type = 'button'; bcRandBtn.className = 'sf-bc-btn';
  bcRandBtn.innerHTML = '🎲 สุ่ม';
  bcRandBtn.onclick = function() {
    var allBcs = [];
    if (el(sectionId)) el(sectionId).querySelectorAll('.opt-barcode').forEach(function(bi) { if (bi.value) allBcs.push(bi.value); });
    bcInp.value = allBcs.length ? nextOptionBarcode(allBcs) : generateRandomBarcode();
  };

  // Preview barcode
  var bcPreviewBtn = document.createElement('button'); bcPreviewBtn.type = 'button'; bcPreviewBtn.className = 'sf-bc-btn';
  bcPreviewBtn.innerHTML = '📊'; bcPreviewBtn.title = 'แสดงบาร์โค้ด';
  bcPreviewBtn.onclick = function() {
    var v = bcInp.value.trim();
    if (!v) { toast('กรอกบาร์โค้ดก่อน', 'error'); return; }
    generateBarcode(v, bcInp.id);
    var pw = document.getElementById(bcInp.id + '_barcode');
    if (pw) pw.style.display = 'block';
  };

  bcRow.appendChild(bcInp); bcRow.appendChild(bcScanBtn); bcRow.appendChild(bcRandBtn); bcRow.appendChild(bcPreviewBtn);
  bcGrp.appendChild(bcLbl); bcGrp.appendChild(bcRow); body.appendChild(bcGrp);

  // Barcode canvas
  var bcPrev = document.createElement('div'); bcPrev.id = bcInp.id + '_barcode';
  bcPrev.className = 'bc-preview-wrap';
  var cvs = document.createElement('canvas'); cvs.id = bcInp.id + '_canvas'; bcPrev.appendChild(cvs);
  body.appendChild(bcPrev);

  // ── Stock field ──
  var stockGrp = document.createElement('div'); stockGrp.className = 'sf-group'; stockGrp.style.marginTop = '10px';
  var stockLbl = document.createElement('label'); stockLbl.textContent = 'สต็อก';
  var stockInp = document.createElement('input'); stockInp.type = 'number'; stockInp.className = 'opt-stock';
  stockInp.value = (opt.stock !== null && opt.stock !== undefined) ? opt.stock : '';
  stockInp.placeholder = 'ว่าง = ไม่จำกัด';
  stockGrp.appendChild(stockLbl); stockGrp.appendChild(stockInp); body.appendChild(stockGrp);

  row.appendChild(body);
  return row;
}

function collectOptionRows(sectionId) {
  var section = el(sectionId); if (!section) return [];
  var rows = section.querySelectorAll('.opt-card');
  var result = [];
  rows.forEach(function(row) {
    var imgFid = row.getAttribute('data-img-field') || '';
    // opt-image-url-hidden holds final URL; opt-url-inp class holds text fallback
    var imgUrl = '';
    var hiddenImg = row.querySelector('.opt-image-url-hidden');
    if (hiddenImg && hiddenImg.value.trim()) imgUrl = hiddenImg.value.trim();
    var urlInpEl = row.querySelector('.opt-url-inp');
    if (!imgUrl && urlInpEl && urlInpEl.value.trim()) imgUrl = urlInpEl.value.trim();
    result.push({
      id:         (row.querySelector('.opt-barcode') && row.querySelector('.opt-barcode').value.trim()) || '',
      name:       (row.querySelector('.opt-name') && row.querySelector('.opt-name').value.trim()) || '',
      stock:      (row.querySelector('.opt-stock') && row.querySelector('.opt-stock').value.trim()) || '',
      image:      imgUrl,
      imgFieldId: imgFid
    });
  });
  return result;
}

/**
 * Resolve all per-option images (upload pending ones), then call cb(resolvedOptions).
 * resolvedOptions: same as options[] but image fields are set to final URLs.
 */
function resolveAllOptionImages(options, cb) {
  if (!options || !options.length) { cb([]); return; }
  var resolved = options.map(function(o) { return Object.assign ? Object.assign({}, o) : JSON.parse(JSON.stringify(o)); });
  // Also sync URL field values into image field before upload check
  resolved.forEach(function(o) {
    if (!o.image) {
      var urlEl = document.getElementById(o.imgFieldId + '_url');
      if (urlEl && urlEl.value.trim()) o.image = urlEl.value.trim();
    }
  });
  var pending = resolved.filter(function(o) { return pendingImg[o.imgFieldId]; });
  if (!pending.length) { cb(resolved); return; }

  var remaining = pending.length;
  pending.forEach(function(o) {
    var b64 = pendingImg[o.imgFieldId];
    google.script.run
      .withSuccessHandler(function(r) {
        delete pendingImg[o.imgFieldId];
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') o.image = res.url;
        } catch(ex) {}
        remaining--;
        if (remaining === 0) cb(resolved);
      })
      .withFailureHandler(function() {
        delete pendingImg[o.imgFieldId];
        remaining--;
        if (remaining === 0) cb(resolved);
      })
      .adminUploadImage(b64);
  });
}

// ── Edit parent stock product ──

// ════════════════════════════════════════════════════════════
// BULK ADD to STOCK
// ════════════════════════════════════════════════════════════
function openBulkStockModal() {
  var keySeq = 0;
  var bulkSRows = [makeBulkSRow()];

  function makeBulkSRow(d) {
    return {
      key: 'sbulk_img_' + (keySeq++), // stable image key — survives row deletes
      name: (d&&d.name)||'', price: (d&&d.price)||'',
      deposit: (d&&d.deposit)||'', yuan: (d&&d.yuan)||'',
      stock: (d&&d.stock)||'', id: (d&&d.id)||generateRandomBarcode(),
      image: (d&&d.image)||'',
      mode: (d&&d.mode)||'single',
      opts: (d&&d.opts)||[],
      idAuto: !(d&&d.id), // random placeholder barcode — the next scan fills it
      ai: '',             // '' | 'busy' | 'done' | 'error'
      origImg: '',        // photo replaced by AI, for undo
      status: 'pending'
    };
  }
  function makeBulkSOpt() { return { key: 'sbulk_opt_img_' + (keySeq++), name:'', id: generateRandomBarcode(), idAuto: true, ai: '', image:'', stock:'' }; }
  function optImage(o) { return pendingImg[o.key] || (o.image && !o.image.startsWith('__pending__') ? o.image : ''); }

  // Variant photos first: one variant per photo, reusing a trailing empty one
  function addOptionPhotos(r, files) {
    Promise.all(Array.from(files).map(function(f) {
      return new Promise(function(res) { var rd = new FileReader(); rd.onload = function(e) { res(e.target.result); }; rd.onerror = function() { res(''); }; rd.readAsDataURL(f); });
    })).then(function(urls) {
      urls.filter(Boolean).forEach(function(u) {
        var last = r.opts[r.opts.length - 1];
        var o = (last && !last.name.trim() && !optImage(last)) ? last : null;
        if (!o) { o = makeBulkSOpt(); r.opts.push(o); }
        pendingImg[o.key] = u; o.image = '';
      });
      rerender();
    });
  }

  // Variant AI: only what tells this variant apart (character, colour, design)
  function identifyOption(r, o) {
    var img = optImage(o);
    if (!img) { toast('เพิ่มรูปตัวเลือกก่อน แล้วให้ AI ช่วยตั้งชื่อ', 'error'); return; }
    o.ai = 'busy'; rerender();
    shrinkImage(img, 1024, function(small) {
      google.script.run.withSuccessHandler(function(s) {
        var res; try { res = JSON.parse(s); } catch (e) { res = { message: 'AI ตอบกลับผิดรูปแบบ' }; }
        if (res.status === 'Success' && res.name) { o.name = res.name; o.ai = 'done'; }
        else { o.ai = 'error'; toast(res.message || 'AI ระบุตัวเลือกไม่สำเร็จ', 'error'); }
        rerender();
      }).withFailureHandler(function() { o.ai = 'error'; rerender(); })
        .adminIdentifyProduct(small, { variant: true, product: r.name });
    });
  }

  function rerender() { var sl = document.getElementById('bulkSList'); if (sl) renderBulkSRows(sl); }
  function rowImage(r) { return pendingImg[r.key] || (r.image && !r.image.startsWith('__pending__') ? r.image : ''); }
  // Reuse the last row while it is still empty, else add one with its prices
  function takeBlankRow() {
    var last = bulkSRows[bulkSRows.length - 1];
    if (last.status !== 'done' && !last.name.trim() && !rowImage(last)) return last;
    var r = makeBulkSRow({ price: last.price, deposit: last.deposit, yuan: last.yuan });
    bulkSRows.push(r); return r;
  }

  // ── Photos first: one row per picked photo, in pick order ──
  function addPhotos(files) {
    Promise.all(Array.from(files).map(function(f) {
      return new Promise(function(res) { var rd = new FileReader(); rd.onload = function(e) { res(e.target.result); }; rd.onerror = function() { res(''); }; rd.readAsDataURL(f); });
    })).then(function(urls) {
      urls.filter(Boolean).forEach(function(u) { var r = takeBlankRow(); pendingImg[r.key] = u; r.image = ''; });
      rerender();
      toast('เพิ่มรูปแล้ว ' + urls.length + ' รายการ — กด ✨ AI ให้ช่วยตั้งชื่อได้', 'success');
    });
  }

  // ── Scan in a row: each new barcode fills the next row still on a random code ──
  function onScanned(code) {
    code = String(code || '').trim(); if (!code) return;
    var key = code.toLowerCase();
    var dup = bulkSRows.some(function(r) {
      return (!r.idAuto && r.id.trim().toLowerCase() === key) ||
        r.opts.some(function(o) { return !o.idAuto && String(o.id).trim().toLowerCase() === key; });
    });
    if (dup) { toast('สแกนซ้ำ: ' + code, 'error'); return; }
    google.script.run.withSuccessHandler(function(s) {
      var res; try { res = JSON.parse(s); } catch (e) { res = {}; }
      if (res.found) { toast('มีในคลังแล้ว: ' + (res.item.parentName || res.item.name || code), 'error'); return; }
      // Next slot still on an automatic code, in screen order: a single
      // product, or a variant of an options product
      var target = null;
      bulkSRows.some(function(r) {
        if (r.status === 'done') return false;
        if (r.mode === 'single') { if (r.idAuto) target = r; }
        else target = r.opts.find(function(o) { return o.idAuto; }) || null;
        return !!target;
      });
      if (!target) { var last = bulkSRows[bulkSRows.length - 1]; target = makeBulkSRow({ price: last.price, deposit: last.deposit, yuan: last.yuan }); bulkSRows.push(target); }
      target.id = code; target.idAuto = false;
      rerender(); toast('เพิ่มบาร์โค้ด ' + code, 'success');
    }).adminFindStockByBarcode(code);
  }
  function startScanLoop() {
    var tok = 'sbk_loop_' + Date.now();
    var pop = window.open('', 'sbk_loop', 'width=420,height=600,resizable=yes');
    if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
    var bridge = function(t, code) { if (t === tok) onScanned(code); };
    window.__barcodeResultBridge = bridge;
    pop.document.open(); pop.document.write(makeScannerPopupHtml(tok, true)); pop.document.close();
    var ck = setInterval(function() {
      if (!pop || pop.closed) { clearInterval(ck); if (window.__barcodeResultBridge === bridge) delete window.__barcodeResultBridge; }
    }, 500);
  }

  // ── AI: name the product from its photo and swap in a proper product image ──
  function identifyRow(r, done) {
    var img = rowImage(r);
    if (!img) { if (done) done(); return; }
    r.ai = 'busy'; rerender();
    shrinkImage(img, 1024, function(small) {
      google.script.run.withSuccessHandler(function(s) {
        var res; try { res = JSON.parse(s); } catch (e) { res = { message: 'AI ตอบกลับผิดรูปแบบ' }; }
        if (res.status === 'Success') {
          if (res.name) r.name = res.name;
          if (res.imageUrl) {
            r.origImg = img;
            // the function's own copy: shows even when the source site is blocked here
            pendingImg[r.key] = res.imageData || res.imageUrl; // uploaded to Cloudinary on save
            r.image = '';
          }
          r.ai = 'done';
        } else { r.ai = 'error'; toast(res.message || 'AI ระบุสินค้าไม่สำเร็จ', 'error'); }
        rerender(); if (done) done();
      }).withFailureHandler(function() { r.ai = 'error'; rerender(); if (done) done(); })
        .adminIdentifyProduct(small);
    });
  }
  function identifyAll() {
    var queue = bulkSRows.filter(function(r) { return r.status !== 'done' && !r.name.trim() && rowImage(r); });
    if (!queue.length) { toast('ไม่มีรายการที่มีรูปแต่ยังไม่มีชื่อ', 'error'); return; }
    // ponytail: 2 at a time keeps a phone responsive; raise if batches get large
    var next = function() { var r = queue.shift(); if (r) identifyRow(r, next); };
    next(); next();
  }
  function undoAiImage(r) {
    if (r.origImg.startsWith('data:')) { pendingImg[r.key] = r.origImg; r.image = ''; }
    else { delete pendingImg[r.key]; r.image = r.origImg; }
    r.origImg = ''; r.ai = ''; rerender();
  }

  function buildBulkSUI() {
    el('modalBody').innerHTML = '';
    var bar = document.createElement('div'); bar.className = 'bulk-toolbar';
    var multi = document.createElement('input'); multi.type = 'file'; multi.accept = 'image/*'; multi.multiple = true; multi.hidden = true;
    multi.onchange = function() { if (multi.files.length) addPhotos(multi.files); multi.value = ''; };
    bar.appendChild(multi);
    bar.appendChild(makeBtn('btn btn-ghost btn-sm', '🖼 เลือกหลายรูป', function() { multi.click(); }));
    bar.appendChild(makeBtn('btn btn-ghost btn-sm', '📷 สแกนต่อเนื่อง', startScanLoop));
    bar.appendChild(makeBtn('btn btn-ghost btn-sm', '✨ AI ตั้งชื่อจากรูป', identifyAll));
    el('modalBody').appendChild(bar);
    var bulkSList = document.createElement('div');
    bulkSList.id = 'bulkSList';
    bulkSList.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:10px;';
    el('modalBody').appendChild(bulkSList);
    renderBulkSRows(bulkSList);
    var addRowBtn2 = document.createElement('button'); addRowBtn2.type = 'button'; addRowBtn2.className = 'add-opt-btn';
    addRowBtn2.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> เพิ่มสินค้า';
    addRowBtn2.style.marginBottom = '6px';
    addRowBtn2.onclick = function() {
      // Batches usually share prices — carry them over from the last row
      var last = bulkSRows[bulkSRows.length - 1];
      bulkSRows.push(makeBulkSRow({ price: last.price, deposit: last.deposit, yuan: last.yuan }));
      var sl = document.getElementById('bulkSList'); if (sl) { renderBulkSRows(sl); focusLastBulkCard(sl); }
    };
    el('modalBody').appendChild(addRowBtn2);
  }

  function renderBulkSRows(container) {
    container.innerHTML = '';
    bulkSRows.forEach(function(row, idx) {
      var card = document.createElement('div');
      card.className = 'bcard' + (row.status === 'done' ? ' done' : row.status === 'error' ? ' error' : '');
      function bInput(key, ph, cls) {
        var i = document.createElement('input'); i.type = 'number'; i.min = '0'; i.inputMode = 'decimal';
        i.className = 'bcard-input' + (cls ? ' ' + cls : ''); i.value = row[key] || ''; i.placeholder = ph;
        i.oninput = function() { row[key] = i.value; };
        return i;
      }
      function bField(label, control) {
        var f = document.createElement('label'); f.className = 'bcard-field';
        var s = document.createElement('span'); s.className = 'bcard-label'; s.textContent = label;
        f.appendChild(s); f.appendChild(control); return f;
      }

      // ── Top: photo (+ AI) | name, delete ──
      var top = document.createElement('div'); top.className = 'bcard-top';
      var photoCol = document.createElement('div'); photoCol.className = 'bcard-photo';
      var sImgB = makeBulkImgBox(row.key, row.image && !row.image.startsWith('__pending__') ? row.image : '', function(v) { row.image = v; row.origImg = ''; });
      sImgB.el.title = 'แตะเพื่อเลือกรูปหรือถ่ายรูป';
      photoCol.appendChild(sImgB.el);
      var num = document.createElement('span'); num.className = 'bcard-num';
      num.textContent = row.status === 'done' ? '✓' : row.status === 'error' ? '!' : String(idx + 1);
      photoCol.appendChild(num);
      var aiBtn = document.createElement('button'); aiBtn.type = 'button'; aiBtn.className = 'bulk-ai-btn';
      aiBtn.textContent = row.ai === 'busy' ? '✨ ...' : '✨ AI';
      aiBtn.title = 'AI ตั้งชื่อและหารูปสินค้าจากรูปที่ถ่าย';
      aiBtn.disabled = row.ai === 'busy';
      aiBtn.onclick = function() { if (!rowImage(row)) { toast('เพิ่มรูปก่อน แล้วให้ AI ช่วยตั้งชื่อ', 'error'); return; } identifyRow(row); };
      photoCol.appendChild(aiBtn);
      top.appendChild(photoCol);

      var main = document.createElement('div'); main.className = 'bcard-main';
      var sNInp = document.createElement('input'); sNInp.type = 'text'; sNInp.className = 'bcard-input bcard-name';
      sNInp.value = row.name || ''; sNInp.placeholder = 'ชื่อสินค้า *';
      sNInp.setAttribute('aria-label', 'ชื่อสินค้า');
      sNInp.oninput = function() { row.name = sNInp.value; };
      main.appendChild(sNInp);
      if (row.status === 'saving') main.appendChild(div('bulk-ai-note', 'กำลังบันทึก...'));
      if (row.origImg) {
        var undo = document.createElement('button'); undo.type = 'button'; undo.className = 'bulk-ai-undo';
        undo.textContent = '↩ ใช้รูปที่ถ่าย'; undo.onclick = function() { undoAiImage(row); };
        main.appendChild(undo);
      } else if (row.ai === 'done') {
        main.appendChild(div('bulk-ai-note', 'ไม่พบรูปสินค้า ใช้รูปที่ถ่าย'));
      }
      top.appendChild(main);
      var cdelBtn = document.createElement('button'); cdelBtn.type = 'button'; cdelBtn.className = 'bcard-del';
      cdelBtn.innerHTML = '×'; cdelBtn.setAttribute('aria-label', 'ลบแถวนี้');
      cdelBtn.onclick = function() { if (bulkSRows.length > 1) { bulkSRows.splice(idx, 1); rerender(); } };
      top.appendChild(cdelBtn);
      card.appendChild(top);

      var body = document.createElement('div'); body.className = 'bcard-body';

      // ── Price: chips + box ──
      var sPriceInp = document.createElement('input'); sPriceInp.value = row.price || '';
      sPriceInp.oninput = function() { row.price = sPriceInp.value; };
      body.appendChild(bField('ราคาเต็ม', makePriceChips(sPriceInp)));

      // ── Stock + barcode (single products; options carry their own) ──
      if (row.mode === 'single') {
        var sb = document.createElement('div'); sb.className = 'bcard-pair';
        sb.appendChild(bField('สต็อก', bInput('stock', '∞ ไม่จำกัด')));
        var bcWrap = document.createElement('div'); bcWrap.className = 'bcard-bc';
        var sIdInp = document.createElement('input'); sIdInp.type = 'text'; sIdInp.className = 'bcard-input bcard-mono';
        // A random placeholder code stays hidden — it's generated, not scanned
        sIdInp.value = row.idAuto ? '' : (row.id || ''); sIdInp.placeholder = 'อัตโนมัติ';
        sIdInp.oninput = function() {
          var v = sIdInp.value.trim();
          if (v) { row.id = v; row.idAuto = false; } else { row.id = generateRandomBarcode(); row.idAuto = true; }
        };
        var sScanBtn = document.createElement('button'); sScanBtn.type = 'button'; sScanBtn.className = 'bcard-scan';
        sScanBtn.innerHTML = '📷'; sScanBtn.setAttribute('aria-label', 'สแกนบาร์โค้ด');
        sScanBtn.onclick = (function(inp,btn){ return function(){
          var tok='sbk_bc_'+Date.now(); var pop=window.open('','sbk_bc_'+idx,'width=420,height=600,resizable=yes');
          if(!pop){toast('กรุณาอนุญาต Pop-up','error');return;}
          btn.innerHTML='⏹';btn.disabled=true;
          function srst(){btn.innerHTML='📷';btn.disabled=false;}
          window.__barcodeResultBridge=function(t,bc){if(t!==tok)return;inp.value=bc;row.id=bc;row.idAuto=false;delete window.__barcodeResultBridge;srst();try{if(pop&&!pop.closed)pop.close();}catch(e){}};
          pop.document.open();pop.document.write(makeScannerPopupHtml(tok));pop.document.close();
          var ck=setInterval(function(){try{if(pop&&!pop.closed&&pop.__barcodeResult){var rv=pop.__barcodeResult;clearInterval(ck);delete window.__barcodeResultBridge;inp.value=rv;row.id=rv;row.idAuto=false;srst();pop.close();return;}if(!pop||pop.closed){clearInterval(ck);delete window.__barcodeResultBridge;srst();}}catch(e2){clearInterval(ck);srst();}},250);
        };})(sIdInp,sScanBtn);
        bcWrap.appendChild(sIdInp); bcWrap.appendChild(sScanBtn);
        sb.appendChild(bField('บาร์โค้ด', bcWrap));
        body.appendChild(sb);
      }

      // ── More: deposit, yuan, has-options (collapsed; summary shows what's set) ──
      var more = document.createElement('details'); more.className = 'bcard-more';
      more.open = !!row.moreOpen || row.mode === 'options';
      more.ontoggle = function() { row.moreOpen = more.open; };
      var bits = [];
      if (Number(row.deposit)) bits.push('มัดจำ ฿' + row.deposit);
      if (Number(row.yuan)) bits.push('¥' + row.yuan);
      if (row.mode === 'options') bits.push(row.opts.length + ' ตัวเลือก');
      var sum = document.createElement('summary');
      sum.textContent = 'เพิ่มเติม' + (bits.length ? ' · ' + bits.join(' · ') : ' — มัดจำ, หยวน, ตัวเลือก');
      more.appendChild(sum);
      var mp = document.createElement('div'); mp.className = 'bcard-pair';
      mp.appendChild(bField('มัดจำ (฿)', bInput('deposit', '0')));
      mp.appendChild(bField('ราคาหยวน (¥)', bInput('yuan', '0')));
      more.appendChild(mp);
      var optTog = document.createElement('label'); optTog.className = 'bcard-check';
      var optChk = document.createElement('input'); optChk.type = 'checkbox'; optChk.checked = row.mode === 'options';
      optChk.onchange = function() {
        row.mode = optChk.checked ? 'options' : 'single';
        if (row.mode === 'options' && !row.opts.length) row.opts.push(makeBulkSOpt());
        rerender();
      };
      optTog.appendChild(optChk); optTog.appendChild(document.createTextNode(' สินค้ามีตัวเลือก (สี / แบบ / ไซส์)'));
      more.appendChild(optTog);
      body.appendChild(more);

      // ── Variants: one compact line each (photo · name · AI · delete / stock · barcode) ──
      if (row.mode === 'options') {
        var oSec = document.createElement('div'); oSec.className = 'bopt';
        var oHead = document.createElement('div'); oHead.className = 'bopt-head';
        oHead.appendChild(div('bcard-label', 'ตัวเลือกสินค้า (' + row.opts.length + ')'));
        var oMulti = document.createElement('input'); oMulti.type = 'file'; oMulti.accept = 'image/*'; oMulti.multiple = true; oMulti.hidden = true;
        oMulti.onchange = function() { if (oMulti.files.length) addOptionPhotos(row, oMulti.files); oMulti.value = ''; };
        var oMultiBtn = document.createElement('button'); oMultiBtn.type = 'button'; oMultiBtn.className = 'bopt-link';
        oMultiBtn.textContent = '🖼 หลายรูป'; oMultiBtn.title = 'เลือกหลายรูป — 1 รูปต่อ 1 ตัวเลือก';
        oMultiBtn.onclick = function() { oMulti.click(); };
        oHead.appendChild(oMulti); oHead.appendChild(oMultiBtn);
        oSec.appendChild(oHead);

        row.opts.forEach(function(opt, oi) {
          var oc = document.createElement('div'); oc.className = 'bopt-row';
          var oIB = makeBulkImgBox(opt.key, opt.image && !opt.image.startsWith('__pending__') ? opt.image : '', function(v) { opt.image = v; });
          oIB.el.classList.add('bopt-img');
          oc.appendChild(oIB.el);

          var oMain = document.createElement('div'); oMain.className = 'bopt-main';
          var oLine1 = document.createElement('div'); oLine1.className = 'bopt-line';
          var oNI = document.createElement('input'); oNI.type = 'text'; oNI.className = 'bcard-input';
          oNI.value = opt.name || ''; oNI.placeholder = 'ชื่อตัวเลือก';
          oNI.setAttribute('aria-label', 'ชื่อตัวเลือก ' + (oi + 1));
          oNI.oninput = function() { opt.name = oNI.value; };
          var oAi = document.createElement('button'); oAi.type = 'button'; oAi.className = 'bopt-ai';
          oAi.textContent = opt.ai === 'busy' ? '…' : '✨'; oAi.disabled = opt.ai === 'busy';
          oAi.title = 'AI ตั้งชื่อตัวเลือกจากรูป'; oAi.setAttribute('aria-label', 'AI ตั้งชื่อตัวเลือกจากรูป');
          oAi.onclick = function() { identifyOption(row, opt); };
          var odel = document.createElement('button'); odel.type = 'button'; odel.className = 'bopt-del';
          odel.innerHTML = '×'; odel.setAttribute('aria-label', 'ลบตัวเลือกนี้');
          odel.onclick = function() { row.opts.splice(oi, 1); if (!row.opts.length) row.mode = 'single'; rerender(); };
          oLine1.appendChild(oNI); oLine1.appendChild(oAi); oLine1.appendChild(odel);
          oMain.appendChild(oLine1);

          var oLine2 = document.createElement('div'); oLine2.className = 'bopt-line';
          var oSI = document.createElement('input'); oSI.type = 'number'; oSI.min = '0'; oSI.inputMode = 'numeric';
          oSI.className = 'bcard-input bopt-stock'; oSI.placeholder = '∞ สต็อก';
          oSI.value = opt.stock !== undefined && opt.stock !== '' ? opt.stock : '';
          oSI.setAttribute('aria-label', 'สต็อกตัวเลือก ' + (oi + 1));
          oSI.oninput = function() { opt.stock = oSI.value; };
          var oBcI = document.createElement('input'); oBcI.type = 'text'; oBcI.className = 'bcard-input bcard-mono';
          oBcI.value = opt.idAuto ? '' : (opt.id || ''); oBcI.placeholder = 'อัตโนมัติ';
          oBcI.setAttribute('aria-label', 'บาร์โค้ดตัวเลือก ' + (oi + 1));
          oBcI.oninput = function() {
            var v = oBcI.value.trim();
            if (v) { opt.id = v; opt.idAuto = false; } else { opt.id = generateRandomBarcode(); opt.idAuto = true; }
          };
          var oBcScan = document.createElement('button'); oBcScan.type = 'button'; oBcScan.className = 'bcard-scan';
          oBcScan.innerHTML = '📷'; oBcScan.setAttribute('aria-label', 'สแกนบาร์โค้ดตัวเลือก');
          oBcScan.onclick = (function(inp, btn) { return function() {
            var tok = 'sbkopt_' + Date.now(); var pop = window.open('', 'sbkopt_' + idx + '_' + oi, 'width=420,height=600,resizable=yes');
            if (!pop) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
            btn.innerHTML = '⏹'; btn.disabled = true;
            function rst2() { btn.innerHTML = '📷'; btn.disabled = false; }
            function apply(bc) { inp.value = bc; opt.id = bc; opt.idAuto = false; rst2(); }
            window.__barcodeResultBridge = function(t, bc) { if (t !== tok) return; delete window.__barcodeResultBridge; apply(bc); try { if (pop && !pop.closed) pop.close(); } catch (e) {} };
            pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
            var ck2 = setInterval(function() { try { if (pop && !pop.closed && pop.__barcodeResult) { var rv = pop.__barcodeResult; clearInterval(ck2); delete window.__barcodeResultBridge; apply(rv); pop.close(); return; } if (!pop || pop.closed) { clearInterval(ck2); delete window.__barcodeResultBridge; rst2(); } } catch (e2) { clearInterval(ck2); rst2(); } }, 250);
          }; })(oBcI, oBcScan);
          oLine2.appendChild(oSI); oLine2.appendChild(oBcI); oLine2.appendChild(oBcScan);
          oMain.appendChild(oLine2);
          oc.appendChild(oMain);
          oSec.appendChild(oc);
        });

        var addOptBtn2 = document.createElement('button'); addOptBtn2.type = 'button'; addOptBtn2.className = 'bopt-add';
        addOptBtn2.textContent = '+ เพิ่มตัวเลือก';
        addOptBtn2.onclick = function() { row.opts.push(makeBulkSOpt()); rerender(); };
        oSec.appendChild(addOptBtn2);
        body.appendChild(oSec);
      }

      card.appendChild(body);
      container.appendChild(card);
    });
  }

  buildBulkSUI();

  openModal('📋 เพิ่มสินค้าหลายรายการเข้าคลัง', '', function() {
    var valid = true;
    bulkSRows.forEach(function(r,i) {
      if (!r.name.trim()) { toast('สินค้า '+(i+1)+': กรุณากรอกชื่อสินค้า','error'); valid=false; }
      if (r.mode==='single' && !r.id.trim()) { toast('สินค้า '+(i+1)+': กรุณากรอก ID','error'); valid=false; }
      if (r.mode==='options' && !r.opts.length) { toast('สินค้า '+(i+1)+': กรุณาเพิ่มตัวเลือก','error'); valid=false; }
      if (r.mode==='options' && r.opts.some(function(o) { return !o.name.trim(); })) { toast('สินค้า '+(i+1)+': กรุณาตั้งชื่อทุกตัวเลือก (หรือกด ✨)','error'); valid=false; }
    });
    if (!valid) return;
    var sb2 = el('modalSave'); sb2.disabled=true; sb2.textContent='กำลังบันทึก...';
    // A retry after partial failure only resends the rows that did not save
    var todo2 = bulkSRows.filter(function(r) { return r.status !== 'done'; });
    var pending2 = todo2.length; var savedCount2 = bulkSRows.length - todo2.length;

    todo2.forEach(function(row) {
      row.status = 'saving';
      var sl0 = document.getElementById('bulkSList'); if (sl0) renderBulkSRows(sl0);

      function doSaveStockRow(imgUrl, resolvedOpts) {
        var optsStr = '';
        if (row.mode==='options' && resolvedOpts && resolvedOpts.length) {
          optsStr = resolvedOpts.map(function(o){ var n=(o.name||'').trim(),id2=(o.id||'').trim(); return id2?n+':'+id2:n; }).join(',');
        }
        var productData = {
          id: row.mode==='single'?(row.id.trim()||generateRandomBarcode()):'',
          name: row.name.trim(), image: imgUrl||'',
          price: Number(row.price)||0, deposit: Number(row.deposit)||0,
          yuan: Number(row.yuan)||0,
          stock: row.mode==='single'?(row.stock.trim()||''):'',
          status: 'Open'
        };
        var optItems = [];
        if (row.mode==='options' && resolvedOpts) {
          optItems = resolvedOpts.map(function(o){ return {id:(o.id||'').trim(), name:(o.name||'').trim(), image:o.image||'', stock:(o.stock===undefined?'':o.stock)}; });
        }
        google.script.run
          .withSuccessHandler(function(r) {
            try { var res=JSON.parse(r); row.status=res.status==='Success'?'done':'error'; if(res.status==='Success') savedCount2++; } catch(e){ row.status='error'; }
            pending2--; var sl2=document.getElementById('bulkSList'); if(sl2) renderBulkSRows(sl2);
            if(pending2===0){ sb2.disabled=false; sb2.textContent='บันทึกทั้งหมด'; toast('บันทึกแล้ว '+savedCount2+'/'+bulkSRows.length+' รายการ',savedCount2===bulkSRows.length?'success':'error'); if(savedCount2===bulkSRows.length) setTimeout(function(){closeModal();loadStock(renderStockContent);},800); }
          })
          .withFailureHandler(function() {
            row.status='error'; pending2--; var sl3=document.getElementById('bulkSList'); if(sl3) renderBulkSRows(sl3);
            if(pending2===0){sb2.disabled=false;sb2.textContent='บันทึกทั้งหมด';}
          })
          .adminCreateStockProduct(productData, optItems);
      }

      // Resolve option images then main image
      function resolveSOpts(mainImgUrl) {
        if (!row.opts || !row.opts.length) { doSaveStockRow(mainImgUrl, []); return; }
        var oUp = row.opts.filter(function(o){ return pendingImg[o.key]; });
        if (!oUp.length) { doSaveStockRow(mainImgUrl, row.opts); return; }
        var op = oUp.length;
        oUp.forEach(function(o) {
          var oKey = o.key;
          google.script.run
            .withSuccessHandler(function(r){delete pendingImg[oKey];var url='';try{var res=JSON.parse(r);if(res.status==='Success')url=res.url;}catch(ex){}o.image=url;op--;if(op===0)doSaveStockRow(mainImgUrl,row.opts);})
            .withFailureHandler(function(){delete pendingImg[oKey];op--;if(op===0)doSaveStockRow(mainImgUrl,row.opts);})
            .adminUploadImage(pendingImg[oKey]);
        });
      }

      var sPKey = row.key;
      if (pendingImg[sPKey]) {
        var sb64 = pendingImg[sPKey];
        google.script.run
          .withSuccessHandler(function(r){delete pendingImg[sPKey];var url='';try{var res=JSON.parse(r);if(res.status==='Success')url=res.url;}catch(ex){}row.image=url;resolveSOpts(url);})
          .withFailureHandler(function(){delete pendingImg[sPKey];resolveSOpts('');})
          .adminUploadImage(sb64);
      } else {
        resolveSOpts(row.image&&!row.image.startsWith('__pending__')?row.image.trim():'');
      }
    });
  }, 'บันทึกทั้งหมด');

  el('modal').classList.add('open');
}


function appendLinkedProductSyncOption(container, inputId, linkedListCount) {
  var count = Number(linkedListCount) || 0;
  var wrap = document.createElement('label');
  wrap.className = 'sf-full';
  wrap.style.cssText = 'display:flex;align-items:flex-start;gap:9px;padding:11px 13px;background:var(--primary-light);border:1.5px solid var(--primary);border-radius:10px;cursor:' + (count ? 'pointer' : 'default') + ';';

  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.id = inputId;
  checkbox.disabled = count < 1;
  checkbox.style.cssText = 'margin-top:2px;accent-color:var(--primary);cursor:' + (count ? 'pointer' : 'not-allowed') + ';';

  var textWrap = document.createElement('span');
  var title = document.createElement('strong');
  title.textContent = 'อัปเดตสินค้าที่นำเข้ารายการแล้วด้วย (' + count + ' รายการ)';
  var note = document.createElement('span');
  note.style.cssText = 'display:block;margin-top:3px;font-size:0.75rem;color:var(--text-2);line-height:1.45;';
  note.textContent = count
    ? 'อัปเดตชื่อ ราคา รูปภาพ สถานะ และตัวเลือก โดยไม่เปลี่ยนจำนวนคงเหลือของแต่ละรายการ'
    : 'ยังไม่มีสินค้าที่เชื่อมกับคลังนี้ รายการเก่าที่มีบาร์โค้ดตรงกันจะเชื่อมหลังรัน schema.sql ล่าสุด';
  textWrap.appendChild(title); textWrap.appendChild(note);
  wrap.appendChild(checkbox); wrap.appendChild(textWrap); container.appendChild(wrap);
  return checkbox;
}

function openEditStockModal(prod) {
  // Same layout as the list-product edit. A product with variants keeps stock
  // and barcodes per variant, so its own stock/barcode fields are hidden.
  el('modalBody').innerHTML = '';
  var hasKids = !!(prod.children && prod.children.length);
  var form = div('epform'); el('modalBody').appendChild(form);
  form.appendChild(fkPhotoName('sepImage', prod.image, 'sepName', prod.name, 'ชื่อสินค้า *'));
  var priceInp = document.createElement('input'); priceInp.id = 'sepPrice'; priceInp.value = prod.price;
  form.appendChild(fkField('ราคาเต็ม', makePriceChips(priceInp)));
  var pair = div('bcard-pair ep-pair');
  pair.appendChild(fkField('มัดจำ (฿)', fkInput('sepDeposit', 'number', prod.deposit, '0'), 'sepDeposit'));
  if (hasKids) pair.appendChild(fkField('ราคาหยวน (¥)', fkInput('sepYuan', 'number', prod.yuan || 0, '0'), 'sepYuan'));
  else pair.appendChild(fkField('สต็อก', fkStock('sepStock', prod.stock), 'sepStock'));
  form.appendChild(pair);
  if (!hasKids) {
    fkBarcode('sepId', prod.id).forEach(function(n) { form.appendChild(n); });
    var more = fkMore('เพิ่มเติม — ราคาหยวน', false);
    more.appendChild(fkField('ราคาหยวน (¥)', fkInput('sepYuan', 'number', prod.yuan || 0, '0'), 'sepYuan'));
    form.appendChild(more);
  }

  // Variants: one compact row each; ✎ opens the variant editor
  var vs = div('ep-variants');
  vs.appendChild(div('bcard-label', 'ตัวเลือกสินค้า' + (hasKids ? ' (' + prod.children.length + ')' : '')));
  (prod.children || []).forEach(function(child) {
    var row = div('ep-vrow');
    var th = div('ep-vthumb');
    if (child.image) { var ci = document.createElement('img'); ci.src = child.image; ci.alt = ''; ci.loading = 'lazy'; th.appendChild(ci); }
    row.appendChild(th);
    var info = div('ep-vinfo');
    var vn = div('ep-vname'); vn.textContent = child.name; info.appendChild(vn);
    var vb = div('ep-vcode'); vb.textContent = child.id || '—'; info.appendChild(vb);
    row.appendChild(info);
    var st = document.createElement('span');
    if (child.stock === null || child.stock === undefined) { st.className = 'stock-count-badge inf'; st.textContent = '∞'; }
    else { st.className = 'stock-count-badge ' + (child.stock <= 3 ? 'low' : 'ok'); st.textContent = child.stock; }
    row.appendChild(st);
    var eb = makeBtn('btn-icon', SVG_EDIT); eb.setAttribute('aria-label', 'แก้ไขตัวเลือก ' + child.name);
    eb.onclick = function() { closeModal(); setTimeout(function() { openEditStockChildModal(child, prod); }, 100); };
    row.appendChild(eb);
    vs.appendChild(row);
  });
  // New variants typed here are created on save
  var newOptSection = document.createElement('div'); newOptSection.id = 'sepNewOptSection';
  newOptSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  vs.appendChild(newOptSection);
  var addChildBtnEl = document.createElement('button'); addChildBtnEl.type = 'button'; addChildBtnEl.className = 'bopt-add';
  addChildBtnEl.textContent = '+ เพิ่มตัวเลือก';
  addChildBtnEl.onclick = function() { addNewOptionRow('sepNewOptSection', newOptSection.querySelectorAll('.opt-card').length, ''); };
  vs.appendChild(addChildBtnEl);
  form.appendChild(vs);

  appendLinkedProductSyncOption(form, 'sepSyncLinked', prod.linkedListCount);

  // Delete lives here, not on the warehouse card, so a stray tap can't hit it
  var danger = div('edit-danger');
  danger.appendChild(makeBtn('btn btn-danger btn-sm', '&#x1F5D1; ลบสินค้านี้ออกจากคลัง', function() { closeModal(); confirmDeleteStockProduct(prod); }));
  form.appendChild(danger);

  openModal('✏️ แก้ไขสินค้า', '', function() {
    var name = el('sepName').value.trim(), id = el('sepId') ? el('sepId').value.trim() : prod.id;
    if (!name) { toast('กรุณากรอกชื่อสินค้า', 'error'); return; }
    stopBarcodeScanner();
    var saveBtn6 = el('modalSave'); saveBtn6.disabled = true; saveBtn6.textContent = 'กำลังบันทึก...';
    var syncLinked = !!(el('sepSyncLinked') && el('sepSyncLinked').checked);

    function finishStockEdit(addedOptions) {
      function finish(message, type) {
        saveBtn6.disabled = false; saveBtn6.textContent = 'บันทึกการแก้ไข';
        closeModal(); toast(message, type || 'success'); loadStock(renderStockContent);
      }
      var baseMessage = addedOptions
        ? 'แก้ไขและเพิ่ม ' + addedOptions + ' ตัวเลือกแล้ว!'
        : 'แก้ไขแล้ว!';
      if (!syncLinked) { finish(baseMessage); return; }

      google.script.run.withSuccessHandler(function(syncResult) {
        try {
          var syncRes = JSON.parse(syncResult);
          if (syncRes.status === 'Success') {
            finish(baseMessage + ' อัปเดต ' + (syncRes.updatedLists || 0) + ' รายการสั่งซื้อ');
          } else {
            finish(baseMessage + ' แต่ซิงก์รายการไม่สำเร็จ: ' + (syncRes.message || 'เกิดข้อผิดพลาด'), 'error');
          }
        } catch(e) { finish(baseMessage + ' แต่ซิงก์รายการไม่สำเร็จ', 'error'); }
      }).adminSyncStockProductToLinked(prod.rowIndex);
    }

    // Collect new inline options
    var newOpts = collectOptionRows('sepNewOptSection');

    resolveImage('sepImage', function(imgUrl) {
      resolveAllOptionImages(newOpts, function(resolvedNewOpts) {
        // First update parent row
        google.script.run.withSuccessHandler(function(r) {
          try {
            var res = JSON.parse(r);
            if (res.status !== 'Success') {
              saveBtn6.disabled = false; saveBtn6.textContent = 'บันทึกการแก้ไข';
              toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return;
            }
            // Then append new children if any
            if (!resolvedNewOpts.length) { finishStockEdit(0); return; }
            var pend = resolvedNewOpts.length;
            var ok = 0;
            resolvedNewOpts.forEach(function(opt) {
              google.script.run.withSuccessHandler(function(r2) {
                try { var res2 = JSON.parse(r2); if (res2.status === 'Success') ok++; } catch(ex) {}
                pend--;
                if (pend === 0) finishStockEdit(ok);
              }).adminAppendStockChild(prod.rowIndex, { id: opt.id, name: opt.name, image: opt.image || '', stock: opt.stock });
            });
          } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
        }).adminUpdateStockRow(prod.rowIndex, 0, id, name,
            imgUrl || prod.image, el('sepPrice').value, el('sepDeposit').value,
            el('sepYuan').value, el('sepStock') ? el('sepStock').value : prod.stock, prod.status);
      });
    });
  }, 'บันทึกการแก้ไข');
  el('modal').classList.add('open');
}

// Open modal to add a NEW child option to an existing parent product
function openAddStockChildModal(parent) {
  el('modalBody').innerHTML = '';
  var form = div('epform'); el('modalBody').appendChild(form);
  form.appendChild(fkParentChip(parent.name));
  form.appendChild(fkPhotoName('scaImage', '', 'scaName', '', 'ชื่อตัวเลือก *'));
  fkBarcode('scaId', '', 'บาร์โค้ดตัวเลือก').forEach(function(n) { form.appendChild(n); });
  form.appendChild(fkField('สต็อก', fkStock('scaStock', ''), 'scaStock'));
  appendLinkedProductSyncOption(form, 'scaSyncLinked', parent.linkedListCount);

  openModal('➕ เพิ่มตัวเลือก: ' + escapeHtml(parent.name), '', function() {
    var name = el('scaName').value.trim(), id = el('scaId').value.trim();
    if (!name) { toast('กรุณากรอกชื่อตัวเลือก', 'error'); return; }
    stopBarcodeScanner();
    var sb = el('modalSave'); sb.disabled = true; sb.textContent = 'กำลังบันทึก...';
    var syncLinked = !!(el('scaSyncLinked') && el('scaSyncLinked').checked);
    resolveImage('scaImage', function(imgUrl) {
      // Create product object and one option
      var productData = { id: parent.id, name: parent.name, image: parent.image || '', price: parent.price, deposit: parent.deposit, yuan: parent.yuan, stock: '', status: parent.status || 'Open' };
      // We add a new row at the sheet level — use adminCreateStockProduct with just one option
      google.script.run.withSuccessHandler(function(r) {
        try {
          var res = JSON.parse(r);
          if (res.status !== 'Success') {
            sb.disabled = false; sb.textContent = 'เพิ่มตัวเลือก';
            toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return;
          }
          if (!syncLinked) {
            closeModal(); toast('เพิ่มตัวเลือกแล้ว!', 'success'); loadStock(renderStockContent); return;
          }
          google.script.run.withSuccessHandler(function(syncResult) {
            sb.disabled = false; sb.textContent = 'เพิ่มตัวเลือก';
            try {
              var syncRes = JSON.parse(syncResult);
              closeModal();
              if (syncRes.status === 'Success') {
                toast('เพิ่มตัวเลือกแล้ว และอัปเดต ' + (syncRes.updatedLists || 0) + ' รายการสั่งซื้อ', 'success');
              } else {
                toast('เพิ่มตัวเลือกแล้ว แต่ซิงก์รายการไม่สำเร็จ: ' + (syncRes.message || 'เกิดข้อผิดพลาด'), 'error');
              }
              loadStock(renderStockContent);
            } catch(ex2) { closeModal(); toast('เพิ่มตัวเลือกแล้ว แต่ซิงก์รายการไม่สำเร็จ', 'error'); loadStock(renderStockContent); }
          }).adminSyncStockProductToLinked(parent.rowIndex);
        } catch(ex) {
          sb.disabled = false; sb.textContent = 'เพิ่มตัวเลือก';
          toast('เกิดข้อผิดพลาด', 'error');
        }
      }).adminAppendStockChild(parent.rowIndex, { id: id, name: name, image: imgUrl || '', stock: el('scaStock').value });
    });
  }, 'เพิ่มตัวเลือก');
  el('modal').classList.add('open');
}

// ── Edit child (option) row ──
function openEditStockChildModal(child, parent) {
  el('modalBody').innerHTML = '';
  var form = div('epform'); el('modalBody').appendChild(form);
  form.appendChild(fkParentChip(parent.name));
  form.appendChild(fkPhotoName('scImage', child.image, 'scName', child.name, 'ชื่อตัวเลือก *'));
  fkBarcode('scId', child.id, 'บาร์โค้ดตัวเลือก *').forEach(function(n) { form.appendChild(n); });
  form.appendChild(fkField('สต็อก', fkStock('scStock', child.stock), 'scStock'));
  appendLinkedProductSyncOption(form, 'scSyncLinked', parent.linkedListCount);

  openModal('&#x270F;&#xFE0F; แก้ไขตัวเลือก', '', function() {
    var name = el('scName').value.trim(), id = el('scId').value.trim();
    if (!name) { toast('กรุณากรอกชื่อตัวเลือก', 'error'); return; }
    stopBarcodeScanner();
    var saveBtn7 = el('modalSave'); saveBtn7.disabled = true; saveBtn7.textContent = 'กำลังบันทึก...';
    var syncLinked = !!(el('scSyncLinked') && el('scSyncLinked').checked);
    resolveImage('scImage', function(imgResolved) {
      var finalImg = imgResolved || child.image || parent.image || '';
      google.script.run.withSuccessHandler(function(r) {
        try {
          var res = JSON.parse(r);
          if (res.status !== 'Success') {
            saveBtn7.disabled = false; saveBtn7.textContent = 'บันทึกการแก้ไข';
            toast(res.message || 'เกิดข้อผิดพลาด', 'error'); return;
          }
          if (!syncLinked) {
            closeModal(); toast('แก้ไขตัวเลือกแล้ว!', 'success'); loadStock(renderStockContent); return;
          }
          google.script.run.withSuccessHandler(function(syncResult) {
            saveBtn7.disabled = false; saveBtn7.textContent = 'บันทึกการแก้ไข';
            try {
              var syncRes = JSON.parse(syncResult);
              closeModal();
              if (syncRes.status === 'Success') {
                toast('แก้ไขตัวเลือกแล้ว และอัปเดต ' + (syncRes.updatedLists || 0) + ' รายการสั่งซื้อ', 'success');
              } else {
                toast('แก้ไขตัวเลือกแล้ว แต่ซิงก์รายการไม่สำเร็จ: ' + (syncRes.message || 'เกิดข้อผิดพลาด'), 'error');
              }
              loadStock(renderStockContent);
            } catch(ex2) { closeModal(); toast('แก้ไขตัวเลือกแล้ว แต่ซิงก์รายการไม่สำเร็จ', 'error'); loadStock(renderStockContent); }
          }).adminSyncStockProductToLinked(parent.rowIndex);
        } catch(e) {
          saveBtn7.disabled = false; saveBtn7.textContent = 'บันทึกการแก้ไข';
          toast('เกิดข้อผิดพลาด', 'error');
        }
      }).adminUpdateStockRow(child.rowIndex, 1, id, name,
          finalImg, parent.price, parent.deposit, parent.yuan,
          el('scStock').value, parent.status);
    });
  }, 'บันทึกการแก้ไข');
  el('modal').classList.add('open');
}

function confirmDeleteStockProduct(prod) {
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x26A0;&#xFE0F;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">ยืนยันการลบ?</div>' +
    '<div style="font-size:0.85rem;color:var(--text-2);">ลบ <strong>' + escapeHtml(prod.name) + '</strong>' +
    (prod.children.length ? ' และ ' + prod.children.length + ' ตัวเลือก' : '') + '</div>';
  el('modalBody').appendChild(wrap);
  openModal('&#x1F5D1; ลบสินค้า', '', function() {
    var saveBtn8 = el('modalSave'); saveBtn8.disabled = true; saveBtn8.textContent = 'กำลังลบ...';
    var childRows = prod.children.map(function(c) { return c.rowIndex; });
    google.script.run.withSuccessHandler(function(r) {
      saveBtn8.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') { closeModal(); toast('ลบสินค้าแล้ว' + photoNote(res.photos), 'success'); loadStock(renderStockContent); }
        else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
      } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
    }).adminDeleteStockProduct(prod.rowIndex, childRows);
  }, 'ลบ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

function confirmDeleteSelectedStock() {
  var rows = Object.keys(_stockDelSelected);
  var picked = stockCache.filter(function(p) { return _stockDelSelected[p.rowIndex]; });
  if (!picked.length) return;
  var kids = picked.reduce(function(s, p) { return s + (p.children ? p.children.length : 0); }, 0);
  var isAll = picked.length === stockCache.length;
  el('modalBody').innerHTML = '';
  var wrap = document.createElement('div'); wrap.style.cssText = 'text-align:center;padding:8px 0;';
  wrap.innerHTML = '<div style="font-size:2.5rem;margin-bottom:12px;">&#x26A0;&#xFE0F;</div>' +
    '<div style="font-weight:700;font-size:0.95rem;margin-bottom:8px;">' + (isAll ? 'ลบสินค้าทั้งหมดในคลัง?' : 'ยืนยันการลบ?') + '</div>' +
    '<div style="font-size:0.85rem;color:var(--text-2);">ลบ <strong>' + picked.length + ' รายการ</strong>' +
    (kids ? ' (รวม ' + kids + ' ตัวเลือก)' : '') + ' ออกจากคลัง<br>' +
    '<span style="color:var(--text-3);">สินค้าที่นำเข้าไปในรายการสั่งซื้อแล้วจะยังอยู่ แต่จะไม่ลิงก์กับคลังอีก · ย้อนกลับไม่ได้</span></div>';
  el('modalBody').appendChild(wrap);
  openModal('&#x1F5D1; ลบสินค้าที่เลือก', '', function() {
    var btn = el('modalSave'); btn.disabled = true; btn.textContent = 'กำลังลบ...';
    google.script.run.withSuccessHandler(function(r) {
      btn.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          closeModal(); toast('ลบสินค้าแล้ว ' + (res.deleted || 0) + ' รายการ' + photoNote(res.photos), 'success');
          _whDelMode = false; _stockDelSelected = {}; renderStockTopbar();
          loadStock(renderStockContent);
        } else { btn.textContent = 'ลบ'; toast(res.message || 'เกิดข้อผิดพลาด', 'error'); loadStock(renderStockContent); }
      } catch(e) { btn.textContent = 'ลบ'; toast('เกิดข้อผิดพลาด', 'error'); }
    }).adminDeleteStockProductsBulk(rows);
  }, 'ลบ ' + picked.length + ' รายการ');
  el('modalSave').className = 'btn btn-danger';
  el('modal').classList.add('open');
}

// ════════════════════════════════
// RESTOCK NOTIFY PANEL
// ════════════════════════════════
function renderRestockPanel() {
  setTopbar('แจ้งเตือนสั่งของ', 'ส่งอีเมล + เพิ่มลงปฏิทิน');
  el('topbarActions').innerHTML = '';

  var wrap = document.createElement('div');
  var card = div('section-card');
  card.appendChild(div('section-card-header', '<div class="section-card-title">&#x1F6D2; ตั้งค่าการแจ้งเตือน</div>'));

  var row1 = document.createElement('div'); row1.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;';

  var shopWrap = div('modal-field'); shopWrap.style.margin = '0';
  var shopLbl = document.createElement('label'); shopLbl.textContent = 'รายการสั่งซื้อ';
  var shopSel = document.createElement('select'); shopSel.id = 'rstShop';
  shopSel.style.cssText = 'width:100%;padding:9px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);font-size:0.85rem;font-family:var(--font);';
  var defO = document.createElement('option'); defO.value = ''; defO.textContent = '-- เลือกรายการ --'; shopSel.appendChild(defO);
  var vl = getVisibleLists();
  for (var i = 0; i < vl.length; i++) {
    var o = document.createElement('option'); o.value = vl[i].sheetId; o.textContent = vl[i].name;
    if (vl[i].sheetId === selectedSheetId && selectedSheetId !== 'ALL') o.selected = true;
    shopSel.appendChild(o);
  }
  shopWrap.appendChild(shopLbl); shopWrap.appendChild(shopSel); row1.appendChild(shopWrap);

  var dateWrap = div('modal-field'); dateWrap.style.margin = '0';
  var dateLbl = document.createElement('label'); dateLbl.textContent = 'วันที่ต้องไปซื้อของ';
  var dateInp = document.createElement('input'); dateInp.type = 'date'; dateInp.id = 'rstDate';
  dateInp.style.cssText = 'width:100%;padding:9px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);font-size:0.85rem;font-family:var(--font);';
  var def7 = new Date(); def7.setDate(def7.getDate() + 7);
  dateInp.value = def7.toISOString().split('T')[0];
  dateWrap.appendChild(dateLbl); dateWrap.appendChild(dateInp); row1.appendChild(dateWrap);
  card.appendChild(row1);

  var noteWrap = div('modal-field'); noteWrap.style.margin = '12px 0';
  var noteLbl = document.createElement('label'); noteLbl.textContent = 'หมายเหตุ (ไม่บังคับ)';
  var noteInp = document.createElement('input'); noteInp.type = 'text'; noteInp.id = 'rstNote';
  noteInp.placeholder = 'เช่น ไปซื้อที่ MBK / ของต้องเข้าก่อน 10/5';
  noteInp.style.cssText = 'width:100%;padding:9px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);font-size:0.85rem;font-family:var(--font);';
  noteWrap.appendChild(noteLbl); noteWrap.appendChild(noteInp); card.appendChild(noteWrap);

  var emailSection = div('modal-field'); emailSection.style.margin = '12px 0';
  var emailLbl = document.createElement('label'); emailLbl.textContent = 'ส่งอีเมลถึง (เลือกได้หลายคน)';
  var emailBox = div(''); emailBox.id = 'rstEmailBox';
  emailBox.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:10px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);background:var(--surface-2);min-height:44px;';
  emailBox.innerHTML = '<span style="font-size:0.8rem;color:var(--text-3);">กำลังโหลดรายชื่อ...</span>';
  emailSection.appendChild(emailLbl); emailSection.appendChild(emailBox); card.appendChild(emailSection);

  var optRow = document.createElement('div'); optRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0;';

  var calCard = div('section-card'); calCard.style.cssText = 'padding:14px;margin:0;';
  var calHeader = document.createElement('div'); calHeader.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  var calChk = document.createElement('input'); calChk.type = 'checkbox'; calChk.id = 'rstCal'; calChk.checked = true;
  calChk.style.cssText = 'width:16px;height:16px;accent-color:var(--primary);cursor:pointer;';
  var calLbl2 = document.createElement('label'); calLbl2.htmlFor = 'rstCal'; calLbl2.textContent = 'เพิ่มใน Google Calendar';
  calLbl2.style.cssText = 'font-size:0.85rem;font-weight:600;color:var(--text);cursor:pointer;';
  calHeader.appendChild(calChk); calHeader.appendChild(calLbl2); calCard.appendChild(calHeader);
  var calDesc = document.createElement('div'); calDesc.style.cssText = 'font-size:0.76rem;color:var(--text-3);line-height:1.5;';
  calDesc.textContent = 'สร้าง event วันที่เลือก พร้อม reminder 1 วันก่อน และแนบรายการสินค้าไว้ในคำอธิบาย';
  calCard.appendChild(calDesc); optRow.appendChild(calCard);

  var previewCard = div('section-card'); previewCard.style.cssText = 'padding:14px;margin:0;cursor:pointer;'; previewCard.id = 'rstPreviewCard';
  var pvHeader = div('section-card-title', '&#x1F441;&#xFE0F; ดูตัวอย่างข้อมูล');
  pvHeader.style.cssText = 'font-size:0.85rem;font-weight:600;color:var(--text);margin-bottom:4px;';
  var pvDesc = document.createElement('div'); pvDesc.style.cssText = 'font-size:0.76rem;color:var(--text-3);';
  pvDesc.textContent = 'โหลดข้อมูลจากชีต Summary Order เพื่อตรวจสอบก่อนส่ง';
  previewCard.appendChild(pvHeader); previewCard.appendChild(pvDesc);
  previewCard.onclick = loadRestockPreview;
  optRow.appendChild(previewCard);
  card.appendChild(optRow);

  var sendBtn = makeBtn('btn btn-primary', '&#x1F4E7; ส่งแจ้งเตือน', sendRestockNotify);
  sendBtn.id = 'rstSendBtn';
  sendBtn.style.cssText = 'width:100%;padding:14px;font-size:1rem;margin-top:8px;';
  card.appendChild(sendBtn);
  wrap.appendChild(card);

  var previewArea = document.createElement('div'); previewArea.id = 'rstPreview';
  wrap.appendChild(previewArea);

  el('content').innerHTML = ''; el('content').appendChild(wrap);

  google.script.run.withSuccessHandler(function(r) {
    var emailBox2 = el('rstEmailBox'); if (!emailBox2) return;
    emailBox2.innerHTML = '';
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        for (var i = 0; i < res.emails.length; i++) {
          var em = res.emails[i];
          var chip = document.createElement('label');
          chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:var(--primary-light);border:1.5px solid var(--primary);border-radius:20px;padding:5px 12px;font-size:0.8rem;cursor:pointer;transition:all 0.15s;';
          var chk2 = document.createElement('input'); chk2.type = 'checkbox'; chk2.value = em; chk2.checked = true;
          chk2.style.cssText = 'accent-color:var(--primary);cursor:pointer;';
          chk2.onchange = function() {
            var p = this.parentElement;
            if (p) { p.style.borderColor = this.checked ? 'var(--primary)' : 'var(--border-strong)'; p.style.background = this.checked ? 'var(--primary-light)' : 'var(--surface)'; }
          };
          chip.appendChild(chk2);
          var emailTxt = document.createElement('span'); emailTxt.textContent = em; emailTxt.style.color = 'var(--text)';
          chip.appendChild(emailTxt); emailBox2.appendChild(chip);
        }
      } else { emailBox2.innerHTML = '<span style="font-size:0.8rem;color:var(--error);">โหลดรายชื่อไม่สำเร็จ</span>'; }
    } catch(ex) { emailBox2.innerHTML = '<span style="font-size:0.8rem;color:var(--error);">เกิดข้อผิดพลาด</span>'; }
  }).adminGetNotifyEmails();

  if (shopSel.value) { setTimeout(loadRestockPreview, 300); }
  shopSel.onchange = function() { el('rstPreview').innerHTML = ''; };
}

function loadRestockPreview() {
  var sheetId = el('rstShop') && el('rstShop').value;
  if (!sheetId) { toast('กรุณาเลือกรายการสั่งซื้อก่อน', 'error'); return; }
  var area = el('rstPreview'); if (!area) return;
  area.innerHTML = ''; area.appendChild(makeSpinner());
  google.script.run.withSuccessHandler(function(r) {
    area.innerHTML = '';
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') { area.appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message))); return; }
      renderRestockPreview(res.rows, area);
    } catch(e) { area.appendChild(div('state-empty', 'เกิดข้อผิดพลาด')); }
  }).adminGetSummaryOrder(sheetId);
}

function renderRestockPreview(rows, area) {
  if (!rows || !rows.length) { area.appendChild(div('state-empty', '&#x1F4ED; ไม่มีข้อมูลในชีต Summary Order')); return; }
  var active = rows.filter(function(r) { return r.qty > 0; });
  var allCount = rows.filter(function(r) { return r.name; }).length;
  var card = div('section-card');
  var hdr2 = div('section-card-header');
  hdr2.appendChild(div('section-card-title', '&#x1F4CB; ตัวอย่างข้อมูลที่จะส่ง (' + active.length + ' รายการ / ทั้งหมด ' + allCount + ')'));
  card.appendChild(hdr2);
  var totalYuan = 0, totalTHB = 0;
  for (var i = 0; i < active.length; i++) { totalYuan += active[i].totalYuan; totalTHB += active[i].totalTHB; }
  var sr = div('stat-row'); sr.style.marginBottom = '14px';
  sr.appendChild(makeStat('รายการที่มีออเดอร์', active.length, 'primary'));
  sr.appendChild(makeStat('รวมหยวน', '¥' + totalYuan, ''));
  sr.appendChild(makeStat('รวม THB', '฿' + totalTHB.toLocaleString(), 'success'));
  card.appendChild(sr);
  var scrl = document.createElement('div'); scrl.style.overflowX = 'auto';
  var tbl = document.createElement('table'); tbl.className = 'data-table';
  tbl.innerHTML = '<thead><tr><th>สินค้า</th><th style="text-align:center;">จำนวน</th><th style="text-align:right;">ราคา/หยวน</th><th style="text-align:right;">รวมหยวน</th><th style="text-align:right;">ราคา/THB</th><th style="text-align:right;">รวม THB</th></tr></thead>';
  var tbody = document.createElement('tbody');
  for (var j = 0; j < active.length; j++) {
    var row2 = active[j];
    var tr = document.createElement('tr');
    var cells = [
      { text: row2.name, style: 'font-weight:600;font-size:0.82rem;' },
      { text: row2.qty, style: 'text-align:center;font-weight:700;color:var(--primary);' },
      { text: '¥' + row2.priceYuan, style: 'text-align:right;' },
      { text: '¥' + row2.totalYuan, style: 'text-align:right;font-weight:600;' },
      { text: '฿' + row2.priceTHB.toLocaleString(), style: 'text-align:right;' },
      { text: '฿' + row2.totalTHB.toLocaleString(), style: 'text-align:right;font-weight:700;color:var(--success);' }
    ];
    for (var k = 0; k < cells.length; k++) {
      var td = document.createElement('td'); td.style.cssText = cells[k].style; td.textContent = cells[k].text; tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody); scrl.appendChild(tbl); card.appendChild(scrl); area.appendChild(card);
}

function sendRestockNotify() {
  var sheetId = el('rstShop') && el('rstShop').value;
  if (!sheetId) { toast('กรุณาเลือกรายการสั่งซื้อ', 'error'); return; }
  var buyDate = el('rstDate') && el('rstDate').value;
  if (!buyDate) { toast('กรุณาเลือกวันที่', 'error'); return; }
  var checkboxes = document.querySelectorAll('#rstEmailBox input[type="checkbox"]');
  var emails = [];
  for (var i = 0; i < checkboxes.length; i++) { if (checkboxes[i].checked) emails.push(checkboxes[i].value); }
  if (!emails.length) { toast('กรุณาเลือกผู้รับอีเมลอย่างน้อย 1 คน', 'error'); return; }
  var note = el('rstNote') ? el('rstNote').value.trim() : '';
  var addCal = el('rstCal') ? el('rstCal').checked : false;
  var shopSel2 = el('rstShop');
  var shopName = shopSel2 ? shopSel2.options[shopSel2.selectedIndex].text : 'รายการสั่งซื้อ';
  var btn = el('rstSendBtn'); btn.disabled = true; btn.textContent = 'กำลังส่ง...';
  google.script.run.withSuccessHandler(function(r) {
    btn.disabled = false; btn.innerHTML = '&#x1F4E7; ส่งแจ้งเตือน';
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        var msg = 'ส่งอีเมลแล้ว ' + res.sent + ' คน';
        if (res.calendar) msg += ' + เพิ่มลงปฏิทินแล้ว';
        toast(msg, 'success');
      } else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
    } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
  }).withFailureHandler(function(e) {
    btn.disabled = false; btn.innerHTML = '&#x1F4E7; ส่งแจ้งเตือน';
    toast('เกิดข้อผิดพลาด: ' + e, 'error');
  }).adminSendRestockNotify(sheetId, shopName, buyDate, note, emails, addCal);
}

// ════════════════════════════════
// IMAGE UPLOAD
// ════════════════════════════════
function makeCameraCapture(onFile) {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.setAttribute('capture', 'environment');
  input.className = 'img-source-input';
  input.setAttribute('aria-hidden', 'true');
  input.setAttribute('tabindex', '-1');
  input.onclick = function(e) { e.stopPropagation(); };
  input.onchange = function() {
    var file = this.files && this.files[0];
    if (file) onFile(file);
    // Let the user retake a photo even if the camera reuses the same filename.
    this.value = '';
  };
  return { input: input };
}

var _imageActionTrigger = null;
function closeImageActionPicker(refocus) {
  var picker = document.getElementById('imageActionPicker');
  if (!picker) return false;
  picker.parentNode.removeChild(picker);
  if (refocus !== false && _imageActionTrigger) _imageActionTrigger.focus();
  _imageActionTrigger = null;
  return true;
}

function openImageActionPicker(trigger, cameraInput, fileInput, onUrl) {
  closeImageActionPicker(false);
  _imageActionTrigger = trigger;

  var backdrop = document.createElement('div');
  backdrop.id = 'imageActionPicker';
  backdrop.className = 'image-action-backdrop';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-labelledby', 'imageActionTitle');

  var sheet = document.createElement('div');
  sheet.className = 'image-action-sheet';
  var title = document.createElement('div');
  title.id = 'imageActionTitle';
  title.className = 'image-action-title';
  title.textContent = 'เลือกการทำงาน';
  sheet.appendChild(title);

  var options = document.createElement('div');
  options.className = 'image-action-options';

  function addAction(label, sublabel, iconHtml, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'image-action-option';
    button.innerHTML = '<span class="image-action-icon" aria-hidden="true">' + iconHtml + '</span>' +
      '<span class="image-action-label">' + label + '</span>' +
      '<span class="image-action-sublabel">' + sublabel + '</span>';
    button.onclick = function(e) {
      e.preventDefault();
      action();
    };
    options.appendChild(button);
    return button;
  }

  var cameraIcon = '<svg viewBox="0 0 48 48"><path d="M15 14l3-5h12l3 5h5a5 5 0 015 5v18a5 5 0 01-5 5H10a5 5 0 01-5-5V19a5 5 0 015-5h5z" fill="#ff5f91"/><circle cx="24" cy="28" r="10" fill="#fff"/><circle cx="24" cy="28" r="6" fill="#4777e8"/><circle cx="36" cy="20" r="2" fill="#fff"/></svg>';
  var filesIcon = '<svg viewBox="0 0 48 48"><path d="M5 14a5 5 0 015-5h10l4 5h14a5 5 0 015 5v3H5v-8z" fill="#79b7ff"/><path d="M6 19h36a4 4 0 014 5l-4 15a5 5 0 01-5 4H10a5 5 0 01-5-5V20l1-1z" fill="#3987ed"/></svg>';
  var urlIcon = '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#7656e8"/><path d="M20 29l-2 2a6 6 0 01-8-8l5-5a6 6 0 018 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M28 19l2-2a6 6 0 018 8l-5 5a6 6 0 01-8 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><path d="M18 30l12-12" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>';
  var firstAction = addAction('กล้อง', 'ถ่ายรูปใหม่', cameraIcon, function() {
    closeImageActionPicker(false);
    cameraInput.value = '';
    cameraInput.click();
  });
  addAction('ไฟล์', 'เลือกจากเครื่อง', filesIcon, function() {
    closeImageActionPicker(false);
    fileInput.value = '';
    fileInput.click();
  });
  var urlAction = addAction('URL', 'วางลิงก์รูปภาพ', urlIcon, function() {
    options.style.display = 'none';
    urlPanel.style.display = 'block';
    title.textContent = 'เพิ่มรูปภาพจาก URL';
    urlInput.focus();
  });
  sheet.appendChild(options);

  var urlPanel = document.createElement('div');
  urlPanel.className = 'image-url-panel';
  urlPanel.style.display = 'none';
  var urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.className = 'image-url-input';
  urlInput.placeholder = 'https://example.com/image.jpg';
  urlInput.setAttribute('aria-label', 'URL รูปภาพ');
  var urlError = document.createElement('div');
  urlError.className = 'image-url-error';
  var urlActions = document.createElement('div');
  urlActions.className = 'image-url-actions';
  var urlBack = document.createElement('button');
  urlBack.type = 'button';
  urlBack.className = 'image-url-back';
  urlBack.textContent = 'ย้อนกลับ';
  urlBack.onclick = function() {
    urlPanel.style.display = 'none';
    options.style.display = 'grid';
    title.textContent = 'เลือกการทำงาน';
    urlAction.focus();
  };
  var urlApply = document.createElement('button');
  urlApply.type = 'button';
  urlApply.className = 'image-url-apply';
  urlApply.textContent = 'ใช้รูปนี้';
  function applyEnteredUrl() {
    var url = urlInput.value.trim();
    if (!/^https:\/\//i.test(url)) {
      urlError.textContent = 'กรุณาใช้ลิงก์รูปภาพที่ขึ้นต้นด้วย https://';
      urlInput.focus();
      return;
    }
    if (onUrl) onUrl(url);
    closeImageActionPicker(false);
  }
  urlApply.onclick = applyEnteredUrl;
  urlInput.onkeydown = function(e) { if (e.key === 'Enter') { e.preventDefault(); applyEnteredUrl(); } };
  urlActions.appendChild(urlBack); urlActions.appendChild(urlApply);
  urlPanel.appendChild(urlInput); urlPanel.appendChild(urlError); urlPanel.appendChild(urlActions);
  sheet.appendChild(urlPanel);

  var cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'image-action-cancel';
  cancel.textContent = 'ยกเลิก';
  cancel.onclick = function() { closeImageActionPicker(true); };
  sheet.appendChild(cancel);
  backdrop.appendChild(sheet);
  backdrop.onclick = function(e) { if (e.target === backdrop) closeImageActionPicker(true); };
  document.body.appendChild(backdrop);
  firstAction.focus();
}

function bindImageActionPicker(trigger, cameraInput, fileInput, onUrl) {
  trigger.setAttribute('role', 'button');
  trigger.setAttribute('tabindex', '0');
  trigger.setAttribute('aria-label', 'เลือกกล้อง ไฟล์ หรือ URL รูปภาพ');
  trigger.onclick = function(e) {
    e.preventDefault();
    openImageActionPicker(trigger, cameraInput, fileInput, onUrl);
  };
  trigger.onkeydown = function(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openImageActionPicker(trigger, cameraInput, fileInput, onUrl);
    }
  };
}

function makeImageField(fieldId, currentUrl, labelText) {
  var wrap = div('modal-field');
  var lbl = document.createElement('label'); lbl.textContent = labelText || 'รูปภาพ'; wrap.appendChild(lbl);

  var uploadWrap = div('img-upload-wrap'); uploadWrap.id = fieldId + 'Wrap';
  // Gallery file input (no capture)
  var fileInp = document.createElement('input'); fileInp.type = 'file'; fileInp.accept = 'image/*'; fileInp.className = 'img-source-input';
  fileInp.onclick = function(e) { e.stopPropagation(); };
  fileInp.onchange = function() { handleImgSelect(this, fieldId); };
  var lbTxt = div('img-upload-label', '&#x1F5BC;&#xFE0F; แตะเพื่อเลือกรูป (กล้อง/ไฟล์/URL)');
  var subTxt = div('img-upload-sublabel', 'PNG, JPG, WEBP · ลากไฟล์มาวางได้');
  var statusEl = document.createElement('div'); statusEl.className = 'img-upload-status'; statusEl.id = fieldId + 'Status';
  var prevImg = document.createElement('img'); prevImg.className = 'img-upload-preview'; prevImg.id = fieldId + 'Preview'; prevImg.style.display = 'none';
  uploadWrap.appendChild(fileInp); uploadWrap.appendChild(lbTxt); uploadWrap.appendChild(subTxt);
  uploadWrap.appendChild(statusEl); uploadWrap.appendChild(prevImg);
  var pasteHint = div('img-upload-sublabel', '&#x1F4CB; Ctrl+V เพื่อวางรูปได้เลย');
  pasteHint.style.cssText = 'margin-top:4px;color:var(--primary);font-weight:600;';
  uploadWrap.appendChild(pasteHint);
  wrap.appendChild(uploadWrap);

  var cameraCapture = makeCameraCapture(function() { handleImgSelect(cameraCapture.input, fieldId); });
  wrap.appendChild(cameraCapture.input);

  // The upload zone opens an app chooser for camera, files, or URL.
  var urlInp = document.createElement('input'); urlInp.type = 'text'; urlInp.id = fieldId;
  urlInp.placeholder = 'หรือวาง URL รูปภาพโดยตรง'; urlInp.value = currentUrl || '';
  urlInp.style.marginTop = '8px';
  wrap.appendChild(urlInp);
  bindImageActionPicker(uploadWrap, cameraCapture.input, fileInp, function(url) {
    delete pendingImg[fieldId];
    urlInp.value = url;
    prevImg.src = url; prevImg.style.display = 'block';
    uploadWrap.className = 'img-upload-wrap done';
    statusEl.className = 'img-upload-status done';
    statusEl.textContent = 'ใช้รูปภาพจาก URL แล้ว';
  });
  var _onPaste = function(e) {
    if (!document.getElementById('modal').classList.contains('open')) return;
    if (!document.getElementById(fieldId + 'Wrap')) return;
    var items = e.clipboardData && e.clipboardData.items; if (!items) return;
    for (var i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        var file = items[i].getAsFile(); if (!file) return;
        var reader = new FileReader();
        reader.onload = (function(fid) { return function(ev) { applyImgData(ev.target.result, fid); }; })(fieldId);
        reader.readAsDataURL(file); return;
      }
    }
  };
  document.addEventListener('paste', _onPaste);
  var _origClose = closeModal;
  closeModal = function() { document.removeEventListener('paste', _onPaste); closeModal = _origClose; _origClose(); };
  return wrap;
}
function applyImgData(dataUrl, fieldId) {
  pendingImg[fieldId] = dataUrl;
  var prev = el(fieldId + 'Preview'); if (prev) { prev.src = dataUrl; prev.style.display = 'block'; }
  var uw = el(fieldId + 'Wrap'); if (uw) uw.className = 'img-upload-wrap done';
  var st = el(fieldId + 'Status'); if (st) { st.className = 'img-upload-status done'; st.textContent = 'รูปพร้อมแล้ว (จากคลิปบอร์ด) — จะอัปโหลดเมื่อกดบันทึก'; }
  var urlInp2 = el(fieldId); if (urlInp2) urlInp2.value = '';
}

function handleImgSelect(input, fieldId) {
  var file = input.files && input.files[0]; if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    pendingImg[fieldId] = e.target.result;
    var prev = el(fieldId + 'Preview'); if (prev) { prev.src = e.target.result; prev.style.display = 'block'; }
    var wrap = el(fieldId + 'Wrap'); if (wrap) wrap.className = 'img-upload-wrap done';
    var status = el(fieldId + 'Status'); if (status) { status.className = 'img-upload-status done'; status.textContent = 'รูปพร้อมแล้ว — จะอัปโหลดเมื่อกดบันทึก'; }
    el(fieldId).value = '';
  };
  reader.readAsDataURL(file);
}

// Common full prices as one-tap buttons on the add forms — edit this list to change them
var PRICE_PRESETS = [60, 160, 180];
// [฿60][฿160][฿180][฿ ___] — chips are shortcuts, the box always holds the real price
function makePriceChips(input) {
  var wrap = document.createElement('div'); wrap.className = 'price-chips';
  function sync() {
    var chips = wrap.querySelectorAll('[data-price]');
    for (var i = 0; i < chips.length; i++) chips[i].classList.toggle('active', chips[i].getAttribute('data-price') === String(input.value));
  }
  PRICE_PRESETS.forEach(function(p) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'price-chip';
    b.setAttribute('data-price', p); b.textContent = '฿' + p;
    // fire 'input' so the form's own listeners store the value
    b.onclick = function() { input.value = p; input.dispatchEvent(new Event('input', { bubbles: true })); };
    wrap.appendChild(b);
  });
  var box = document.createElement('label'); box.className = 'price-chip-box';
  box.appendChild(document.createTextNode('฿'));
  input.type = 'number'; input.min = '0'; input.inputMode = 'decimal';
  input.className = 'price-chip-input'; input.placeholder = 'อื่นๆ';
  input.setAttribute('aria-label', 'ราคาเต็ม (บาท)');
  box.appendChild(input); wrap.appendChild(box);
  input.addEventListener('input', sync); sync();
  return wrap;
}

// Phone photos are several MB; the AI only needs ~1024px. Remote URLs pass
// through untouched (a canvas can't read them cross-origin).
function shrinkImage(src, maxSide, cb) {
  if (!/^data:/.test(src)) { cb(src); return; }
  var img = new Image();
  img.onload = function() {
    var k = Math.min(1, maxSide / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    cb(c.toDataURL('image/jpeg', 0.85));
  };
  img.onerror = function() { cb(src); };
  img.src = src;
}

// Single-add form: name the product from the image field's photo and swap in
// a proper product image (uploaded to Cloudinary on save like any photo)
function aiFillFromImageField(fieldId, nameInputId, btn) {
  var src = pendingImg[fieldId] || (el(fieldId) ? el(fieldId).value.trim() : '');
  if (!src) { toast('เพิ่มรูปก่อน แล้วให้ AI ช่วยตั้งชื่อ', 'error'); return; }
  var label = btn.textContent; btn.disabled = true; btn.textContent = '✨ กำลังค้นหา...';
  shrinkImage(src, 1024, function(small) {
    google.script.run.withSuccessHandler(function(s) {
      btn.disabled = false; btn.textContent = label;
      var res; try { res = JSON.parse(s); } catch (e) { res = {}; }
      if (res.status !== 'Success') { toast(res.message || 'AI ระบุสินค้าไม่สำเร็จ', 'error'); return; }
      if (res.name && el(nameInputId)) el(nameInputId).value = res.name;
      if (res.imageUrl) {
        applyImgData(res.imageData || res.imageUrl, fieldId);
        var st = el(fieldId + 'Status'); if (st) st.textContent = 'ใช้รูปสินค้าจาก AI — แตะเพื่อเปลี่ยนรูป';
      }
      toast(res.imageUrl ? 'AI ตั้งชื่อและหารูปสินค้าแล้ว' : 'AI ตั้งชื่อแล้ว (ไม่พบรูปสินค้า)', 'success');
    }).withFailureHandler(function() { btn.disabled = false; btn.textContent = label; toast('AI ระบุสินค้าไม่สำเร็จ', 'error'); })
      .adminIdentifyProduct(small);
  });
}

function resolveImage(fieldId, callback) {
  var pending = pendingImg[fieldId];
  if (pending) {
    var status = el(fieldId + 'Status');
    var wrap = el(fieldId + 'Wrap');
    if (status) { status.className = 'img-upload-status uploading'; status.textContent = 'กำลังอัปโหลดรูป...'; }
    if (wrap) wrap.className = 'img-upload-wrap uploading';
    google.script.run
      .withSuccessHandler(function(r) {
        delete pendingImg[fieldId];
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') {
            if (status) { status.className = 'img-upload-status done'; status.textContent = 'อัปโหลดสำเร็จ!'; }
            if (wrap) wrap.className = 'img-upload-wrap done';
            callback(res.url);
          } else {
            if (status) { status.className = 'img-upload-status error'; status.textContent = 'อัปโหลดไม่สำเร็จ: ' + res.message; }
            callback(null);
          }
        } catch(ex) { callback(null); }
      })
      .withFailureHandler(function() {
        delete pendingImg[fieldId];
        if (status) { status.className = 'img-upload-status error'; status.textContent = 'อัปโหลดไม่สำเร็จ'; }
        callback(null);
      })
      .adminUploadImage(pending);
  } else {
    callback(el(fieldId) ? el(fieldId).value.trim() : '');
  }
}

function openPOSMode(listItem) {
  // POS shares the Supabase session — no credentials in the URL
  google.script.run.withSuccessHandler(function(baseUrl) {
    var url = baseUrl
      + '?page=pos'
      + '&sheetId='  + encodeURIComponent(listItem.sheetId)
      + '&listName=' + encodeURIComponent(listItem.name);
    window.open(url, '_blank');
  }).getWebAppUrl();
}

// ════════════════════════════════
// NOTIFICATIONS — new web orders and slips. Checked every minute while the
// page is open; the bell counts what arrived since the panel was last
// opened. Desktop pop-ups + a sound once the admin allows them.
// ════════════════════════════════
var NOTIF_POLL_MS = 60000;
var NOTIF_KEEP = 60;
var _notif = { events: [], newest: '', loaded: false, title: document.title, audio: null };
function notifSeen(v) {
  try { if (v === undefined) return localStorage.getItem('adminNotifSeen') || ''; localStorage.setItem('adminNotifSeen', v); }
  catch (e) { return ''; }
}
function notifNewer(a, b) { return !b || new Date(a) > new Date(b); }
function notifText(e) {
  if (e.type === 'order') return e.customer + ' สั่ง ' + e.pieces + ' ชิ้น · ' + baht(e.total);
  if (e.type === 'delivered') return '@' + e.customer + ' ได้รับพัสดุแล้ว · ' + Couriers.name(e.courier) + ' ' + e.tracking;
  if (e.deliveryId) return e.customer + ' โอนบิลส่วนที่เหลือ + ค่าส่ง ' + baht(e.total) + ' · พร้อมจัดส่ง';
  return e.customer + ' ส่งสลิป ' + baht(e.total) + (PAY_KIND[e.kind] ? ' · ' + PAY_KIND[e.kind] : '');
}
function timeAgo(d) {
  var s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
  if (s < 86400) return Math.floor(s / 3600) + ' ชั่วโมงที่แล้ว';
  return new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function notifCheck() {
  if (document.hidden) return;
  // First load: the last 7 days; then only what is newer than the newest seen
  apiCall('adminGetNotifications', _notif.newest).then(function(res) {
    if (res.status !== 'Success') return;
    var fresh = (res.events || []).filter(function(e) { return notifNewer(e.at, _notif.newest); });
    if (!_notif.loaded && !notifSeen()) notifSeen(res.now); // first visit ever: start from now, not 7 days back
    if (_notif.loaded && fresh.length) notifAnnounce(fresh);
    _notif.events = fresh.concat(_notif.events).slice(0, NOTIF_KEEP);
    if (fresh.length) _notif.newest = fresh[0].at;
    _notif.loaded = true;
    drawNotifBadge();
    if (!el('notifPanel').hidden) drawNotifPanel();
  });
}

function notifUnread() {
  var seen = notifSeen();
  return _notif.events.filter(function(e) { return notifNewer(e.at, seen); }).length;
}
function drawNotifBadge() {
  var n = notifUnread(), c = el('notifCount');
  c.textContent = n > 99 ? '99+' : n;
  c.hidden = !n;
  el('notifBtn').setAttribute('aria-label', n ? 'การแจ้งเตือน ' + n + ' รายการใหม่' : 'การแจ้งเตือน');
  document.title = (n ? '(' + n + ') ' : '') + _notif.title;
}

function notifAnnounce(fresh) {
  var first = notifText(fresh[0]) + (fresh.length > 1 ? ' และอีก ' + (fresh.length - 1) + ' รายการ' : '');
  toast('🔔 ' + first, 'success');
  if (_notif.audio) {
    try {
      var o = _notif.audio.createOscillator(), g = _notif.audio.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.15, _notif.audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, _notif.audio.currentTime + 0.4);
      o.connect(g); g.connect(_notif.audio.destination); o.start(); o.stop(_notif.audio.currentTime + 0.4);
    } catch (e) {}
  }
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification('Order Hub · ใหม่ ' + fresh.length + ' รายการ', { body: first, tag: 'order-hub' }); } catch (e) {}
  }
}

function drawNotifPanel() {
  var panel = el('notifPanel'), seen = notifSeen();
  panel.innerHTML = '';
  var head = div('notif-head');
  var h = document.createElement('strong'); h.textContent = 'การแจ้งเตือน'; head.appendChild(h);
  var sub = document.createElement('span'); sub.textContent = 'คำสั่งซื้อ สลิป และพัสดุที่ส่งถึง · 7 วันล่าสุด'; head.appendChild(sub);
  panel.appendChild(head);
  if (window.Notification && Notification.permission === 'default') {
    var allow = makeBtn('btn btn-ghost btn-sm notif-allow', '&#x1F514; เปิดแจ้งเตือนบนเครื่อง (มีเสียง)', function() {
      notifEnableSound();
      Notification.requestPermission().then(function() { drawNotifPanel(); });
    });
    allow.type = 'button'; panel.appendChild(allow);
  }
  var list = div('notif-list');
  if (!_notif.events.length) list.appendChild(div('state-empty', _notif.loaded ? 'ยังไม่มีคำสั่งซื้อ สลิป หรือพัสดุที่ส่งถึงใหม่' : 'กำลังโหลด...'));
  _notif.events.forEach(function(e) {
    var row = document.createElement('button'); row.type = 'button';
    row.className = 'notif-item' + (notifNewer(e.at, seen) ? ' unread' : '');
    var ic = document.createElement('span'); ic.className = 'notif-icon ' + e.type;
    ic.textContent = e.type === 'order' ? '🛒' : e.type === 'delivered' ? '📦' : e.deliveryId ? '🚚' : '🧾'; row.appendChild(ic);
    var body = div('notif-body');
    var t = div('notif-text'); t.textContent = notifText(e); body.appendChild(t);
    var m = div('notif-meta');
    m.textContent = (e.listName || '') + (e.type === 'order' && e.deposit ? ' · มีมัดจำ' : '') + (e.type === 'slip' && e.hasAddress ? ' · มีที่อยู่' : '') + ' · ' + timeAgo(e.at);
    body.appendChild(m); row.appendChild(body);
    row.onclick = function() {
      closeNotif();
      if (e.type === 'order') { selectedSheetId = e.listId; selectedSheetName = e.listName; switchPanel('orders'); }
      // Bill paid → ready to ship; delivered → done. Both open the status steps on that customer
      else if (e.type === 'delivered' || e.deliveryId) {
        _stm.stage = e.type === 'delivered' ? 'done' : 'ship'; _stm.list = ''; _stm.q = normCust(e.customer); switchPanel('status');
      } else { _slipView.cat = 'order'; _slipView.list = ''; _slipView.filter = 'all'; _slipView.q = e.customer; switchPanel('slips'); }
    };
    list.appendChild(row);
  });
  panel.appendChild(list);
}

// The browser only lets a page play sound after the admin clicks something
function notifEnableSound() {
  if (_notif.audio) return;
  try { var A = window.AudioContext || window.webkitAudioContext; if (A) _notif.audio = new A(); } catch (e) {}
}
function openNotif() {
  notifEnableSound();
  drawNotifPanel();
  el('notifPanel').hidden = false;
  el('notifBtn').setAttribute('aria-expanded', 'true');
  // Everything listed now counts as read (the panel keeps the highlight until reopened)
  if (_notif.events.length) notifSeen(_notif.events[0].at);
  drawNotifBadge();
}
function closeNotif() {
  el('notifPanel').hidden = true;
  el('notifBtn').setAttribute('aria-expanded', 'false');
}
el('notifBtn').onclick = function(e) { e.stopPropagation(); if (el('notifPanel').hidden) openNotif(); else closeNotif(); };
el('notifPanel').onclick = function(e) { e.stopPropagation(); };
document.addEventListener('click', function() { if (!el('notifPanel').hidden) closeNotif(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && !el('notifPanel').hidden) { closeNotif(); el('notifBtn').focus(); } });
document.addEventListener('visibilitychange', function() { if (!document.hidden) notifCheck(); });
setTimeout(notifCheck, 1500);
setInterval(notifCheck, NOTIF_POLL_MS);
