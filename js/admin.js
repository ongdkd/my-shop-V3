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
var VALID_PANELS = ['orderlists', 'orders', 'products', 'summary', 'status', 'slips', 'restock', 'stock'];
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
  else if (panel === 'summary')    renderSummaryPanel();
  else if (panel === 'restock')    renderRestockPanel();
  else if (panel === 'stock')      renderStockPanel();
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
  // lives in the side menu as "สรุปยอดลูกค้า"
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
      items.appendChild(it);
    });
    gc.appendChild(items);

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
    .forEach(function(l) { if (l && l !== 'ยกเลิก' && l !== 'จัดส่งแล้ว') custom[l] = true; });
  var sf = div('modal-field');
  var sl = document.createElement('label'); sl.htmlFor = 'stSelect'; sl.textContent = 'สถานะ'; sf.appendChild(sl);
  var sel = document.createElement('select'); sel.id = 'stSelect';
  [['shipped', '📦 จัดส่งแล้ว'], ['', 'ยังไม่ส่ง'], ['ยกเลิก', '✕ ยกเลิก']]
    .concat(Object.keys(custom).sort().map(function(c) { return [c, c]; }))
    .concat([['__new', '+ เพิ่มสถานะใหม่…']])
    .forEach(function(op) { var e = document.createElement('option'); e.value = op[0]; e.textContent = op[1]; sel.appendChild(e); });
  // Items still waiting → suggest "shipped"; otherwise show what they share
  var p0 = picked[0];
  var same = picked.every(function(o) { return !!o.shippedAt === !!p0.shippedAt && o.status === p0.status; });
  sel.value = pending.length && !p0.status ? 'shipped' : same ? (p0.shippedAt ? 'shipped' : p0.status) : 'shipped';
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
  tf.appendChild(lbl); tf.appendChild(inp); el('modalBody').appendChild(tf);

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
      chosen.forEach(function(o) { o.shippedAt = res.shippedAt || ''; o.tracking = res.tracking || ''; o.status = res.orderStatus || ''; });
      closeModal();
      toast('อัปเดตสถานะแล้ว ' + chosen.length + ' รายการ', 'success');
      if (opts.after) opts.after();
      else if (_ordLast && document.body.contains(_ordLast.holder)) renderOrdersTable(_ordLast.orders, _ordLast.holder, _ordLast.isAllView);
    }).withFailureHandler(function() {
      saveBtn.disabled = false; toast('บันทึกไม่สำเร็จ', 'error');
    })[opts.api || 'adminSetOrderStatus'](chosen.map(function(o) { return o.id; }).filter(Boolean), status, inp.value);
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
    var at = document.createElement('span'); at.textContent = 'โอน ' + when(p.paidAt); top.appendChild(at);
    box.appendChild(top);
    if (p.bankRef) { var ref = div('pay-line'); ref.textContent = 'เลขอ้างอิง ' + p.bankRef; box.appendChild(ref); }
    var addr = div('pay-addr' + (p.address ? '' : ' muted'));
    addr.textContent = p.address || 'ไม่ได้แนบที่อยู่';
    box.appendChild(addr);
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

// ════════════════════════════════
// SLIPS / ADDRESSES — every slip customers sent, across all lists
// ════════════════════════════════
var _slipView = { list: '', filter: 'all', q: '' };
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

  // Controls: list, filter chips, search
  var ctl = div('section-card slip-ctl');
  var sel = document.createElement('select'); sel.className = 'slip-list'; sel.setAttribute('aria-label', 'รายการสั่งซื้อ');
  var used = {}; pays.forEach(function(p) { used[p.listId] = true; });
  [['', 'ทุกรายการ']].concat(Object.keys(used).map(function(id) { return [id, names[id] || '(รายการที่ลบแล้ว)']; }))
    .forEach(function(o) { var e = document.createElement('option'); e.value = o[0]; e.textContent = o[1]; sel.appendChild(e); });
  sel.value = used[_slipView.list] ? _slipView.list : '';
  sel.onchange = function() { _slipView.list = sel.value; draw(); };
  ctl.appendChild(sel);
  var chips = div('ord-chips');
  [['all', 'ทั้งหมด'], ['addr', 'มีที่อยู่'], ['noaddr', 'ไม่มีที่อยู่'], ['photo', 'ยังมีรูปสลิป']].forEach(function(c) {
    var b = makeBtn('price-chip' + (_slipView.filter === c[0] ? ' active' : ''), c[1], function() {
      _slipView.filter = c[0];
      chips.querySelectorAll('.price-chip').forEach(function(x) { x.classList.toggle('active', x === b); });
      draw();
    });
    b.type = 'button'; chips.appendChild(b);
  });
  ctl.appendChild(chips);
  var sw = div('search-row'); sw.innerHTML = SVG_SEARCH;
  var si = document.createElement('input'); si.placeholder = 'ค้นหาชื่อ / ที่อยู่ / เลขอ้างอิง'; si.value = _slipView.q;
  si.oninput = function() { _slipView.q = si.value; draw(); };
  sw.appendChild(si); ctl.appendChild(sw);
  wrap.appendChild(ctl);

  var stats = div('stat-row'); wrap.appendChild(stats);
  var listBox = div('section-card'); wrap.appendChild(listBox);
  el('content').appendChild(wrap);

  function when(d) { return d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }
  function draw() {
    var q = _slipView.q.trim().toLowerCase();
    var shown = pays.filter(function(p) {
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
    if (!shown.length) { listBox.appendChild(div('state-empty', pays.length ? 'ไม่พบสลิปตามที่ค้นหา' : '&#x1F4ED; ยังไม่มีลูกค้าส่งสลิป')); return; }
    shown.forEach(function(p) {
      var row = document.createElement('button'); row.type = 'button'; row.className = 'slip-row';
      row.setAttribute('aria-label', 'ดูสลิปของ ' + p.customer);
      var main = div('slip-main');
      var top = div('slip-top');
      var nm = document.createElement('strong'); nm.textContent = p.customer; top.appendChild(nm);
      var ln = document.createElement('span'); ln.className = 'slip-listname'; ln.textContent = names[p.listId] || ''; top.appendChild(ln);
      main.appendChild(top);
      var addr = div('slip-addr' + (p.address ? '' : ' muted'));
      addr.textContent = p.address ? p.address.replace(/\s*\n\s*/g, ' · ') : 'ไม่ได้แนบที่อยู่';
      main.appendChild(addr);
      var meta = div('slip-meta');
      meta.textContent = 'โอน ' + when(p.paidAt) + (p.bankRef ? ' · อ้างอิง ' + p.bankRef : '') + (p.hasSlip ? ' · 🖼 มีรูป' : '');
      main.appendChild(meta);
      row.appendChild(main);
      var amt = div('slip-amt'); amt.textContent = baht(p.amount); row.appendChild(amt);
      row.onclick = function() { openPaymentsModal([p], p.customer); };
      listBox.appendChild(row);
    });
  }
  draw();
}

// ════════════════════════════════
// STATUS MANAGER — bulk status for web orders and imported old-sheet rows
// ════════════════════════════════
var _stm = { src: 'web', round: '', cat: '', q: '', web: null, legacy: null };
var STM_CAP = 400; // rows drawn at once; filters narrow the rest

// Shipped / waiting / cancelled / custom label, for both sources
function stmCat(o) {
  if (o.shippedAt || /^จัดส่งแล้ว/.test(o.status || '')) return 'จัดส่งแล้ว';
  return o.status || 'รอจัดส่ง';
}

function renderStatusPanel() {
  setTopbar('จัดการสถานะ', 'อัปเดตสถานะหลายรายการพร้อมกัน');
  el('topbarActions').innerHTML = '';
  el('topbarActions').appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4E5; นำเข้าจากชีต', openImportStatusSheet));
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  var key = _stm.src;
  if (_stm[key]) { drawStatusManager(); return; }
  var run = google.script.run.withSuccessHandler(function(r) {
    var res; try { res = JSON.parse(r); } catch (e) { res = { message: 'เกิดข้อผิดพลาด' }; }
    if (res.status !== 'Success') { el('content').innerHTML = ''; el('content').appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message || 'โหลดไม่สำเร็จ'))); return; }
    _stm[key] = key === 'web'
      ? (res.orders || []).map(function(o) { o.round = o.shopName || ''; return o; })
      : (res.rows || []).map(function(o) { o.shippedAt = ''; return o; });
    if (key === 'legacy' && res.missing) _stm.legacyMissing = true;
    if (_stm.src === key) drawStatusManager();
  }).withFailureHandler(function() { el('content').innerHTML = ''; el('content').appendChild(div('state-empty', 'โหลดไม่สำเร็จ')); });
  if (key === 'web') run.adminGetAllOrders(); else run.adminGetLegacy();
}

function drawStatusManager() {
  var items = _stm[_stm.src] || [];
  el('content').innerHTML = '';
  var wrap = document.createElement('div');

  var ctl = div('section-card slip-ctl');
  var seg = div('ord-seg'); seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'แหล่งข้อมูล');
  [['web', 'ออเดอร์เว็บ'], ['legacy', 'ประวัติจากชีต']].forEach(function(v) {
    var b = makeBtn('ord-seg-btn' + (_stm.src === v[0] ? ' on' : ''), v[1], function() {
      if (_stm.src === v[0]) return;
      _stm.src = v[0]; _stm.round = ''; _stm.cat = ''; renderStatusPanel();
    });
    b.type = 'button'; b.setAttribute('aria-pressed', _stm.src === v[0] ? 'true' : 'false'); seg.appendChild(b);
  });
  ctl.appendChild(seg);

  if (!items.length) {
    wrap.appendChild(ctl);
    var empty = _stm.src === 'legacy'
      ? 'ยังไม่ได้นำเข้าชีตสถานะ — กด "📥 นำเข้าจากชีต" ด้านบน' + (_stm.legacyMissing ? '<br><small>(ต้องรัน supabase/migrations/2026-10-29b-legacy-status.sql ก่อน)</small>' : '')
      : '&#x1F4ED; ยังไม่มีคำสั่งซื้อ';
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
      api: _stm.src === 'web' ? 'adminSetOrderStatus' : 'adminSetLegacyStatus',
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
    list.querySelectorAll('input[type=checkbox]').forEach(function(cb) { cb.checked = allChk.checked; });
    refreshBar();
  };

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
    shown.slice(0, STM_CAP).forEach(function(o) {
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
      var c = stmCat(o);
      var st = div('oitem-ship' + (c === 'จัดส่งแล้ว' ? '' : c === 'ยกเลิก' ? ' cancel' : c === 'รอจัดส่ง' ? ' waiting' : ' custom'));
      st.textContent = (c === 'จัดส่งแล้ว' ? '📦 ' : '') + (o.shippedAt ? 'ส่งแล้ว' : o.status || 'รอจัดส่ง') + (o.tracking ? ' · ' + o.tracking : '');
      main.appendChild(st);
      row.appendChild(main);
      list.appendChild(row);
    });
    if (shown.length > STM_CAP) list.appendChild(div('state-empty', 'แสดง ' + STM_CAP + ' จาก ' + shown.length + ' รายการ — เลือก "ทั้งหมด" จะเลือกครบทุกรายการที่กรองไว้ หรือกรองให้แคบลง'));
    refreshBar();
  }
  draw();
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
      _stm.legacy = null; _stm.legacyMissing = false; _stm.src = 'legacy'; _stm.round = ''; _stm.cat = ''; _stm.q = '';
      renderStatusPanel();
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
// SUMMARY
// ════════════════════════════════
function renderSummaryPanel() {
  setTopbar('สรุปยอดลูกค้า', 'สร้างสรุปยอดสำหรับส่งให้ลูกค้า');
  var wrap = document.createElement('div');
  var card = div('section-card');
  card.appendChild(div('section-card-header', '<div class="section-card-title">&#x1F4CB; เลือกรายการและข้อมูลสรุปยอด</div>'));

  // 1. RESTORED COMBOBOX (Dropdown) for Shop Selection
  var selWrap = div('modal-field');
  selWrap.style.marginBottom = '12px';
  var l1 = document.createElement('label'); l1.textContent = 'รายการสั่งซื้อ'; l1.style.cssText = 'display:block;font-size:0.78rem;font-weight:600;color:var(--text-2);margin-bottom:5px;';
  var sel = document.createElement('select'); sel.id = 'summarySheetPicker'; sel.style.cssText = 'width:100%;padding:9px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);font-size:0.85rem;font-family:var(--font);';
  var defOpt = document.createElement('option'); defOpt.value = ''; defOpt.textContent = '-- เลือกรายการ --'; sel.appendChild(defOpt);
  var visibleLists = getVisibleLists();
  for (var i = 0; i < visibleLists.length; i++) {
    var it = visibleLists[i];
    var opt = document.createElement('option'); opt.value = it.sheetId; opt.textContent = it.name;
    if (it.sheetId === selectedSheetId && selectedSheetId !== 'ALL') opt.selected = true;
    sel.appendChild(opt);
  }
  selWrap.appendChild(l1); selWrap.appendChild(sel); card.appendChild(selWrap);

  // 2. CSS Grid Form Container for everything else
  var formGrid = document.createElement('div');
  formGrid.className = 'summary-form-grid';
  
  function createField(id, label, type, val, placeholder) {
    var w = div('modal-field');
    var l = document.createElement('label'); l.textContent = label;
    var inp = type === 'select' ? document.createElement('select') : document.createElement('input');
    if (type === 'select') inp.innerHTML = '<option value="">-- กรุณาเลือกรายการด้านบนก่อน --</option>';
    else { inp.type = type; if(val) inp.value = val; if(placeholder) inp.placeholder = placeholder; }
    inp.id = id;
    w.appendChild(l); w.appendChild(inp);
    return w;
  }

  formGrid.appendChild(createField('summaryCustomerName', 'ชื่อลูกค้า', 'select')); 
  formGrid.appendChild(createField('sumStartDate', 'กรองตั้งแต่วันที่', 'date'));      
  formGrid.appendChild(createField('sumEndDate', 'ถึงวันที่', 'date'));            
  formGrid.appendChild(createField('sumDelFee', 'ค่าจัดส่ง', 'number', '40'));      
  formGrid.appendChild(createField('sumProdGetDate', 'วันที่สินค้าเข้า', 'text', 'จ-อ 22-23/12')); 
  formGrid.appendChild(createField('sumDelDate1', 'รอบส่งที่ 1', 'text', 'พ 24/12'));  
  formGrid.appendChild(createField('sumDelDate2', 'รอบส่งที่ 2', 'text', 'ส. 27/12')); 
  card.appendChild(formGrid);

  // 3. Generate Button
  var btnGen = makeBtn('btn btn-primary', '&#x2728; สร้างสรุปยอด', generateSummary);
  btnGen.style.width = '100%'; btnGen.style.padding = '14px'; btnGen.style.fontSize = '1rem';
  card.appendChild(btnGen);
  wrap.appendChild(card);

  // 4. Auto-fetch logic for the combobox
  sel.onchange = function() {
    var sid = this.value;
    var custSel = el('summaryCustomerName');
    custSel.innerHTML = '<option value="">กำลังโหลดรายชื่อ...</option>';
    custSel.disabled = true;
    if (!sid) { custSel.innerHTML = '<option value="">-- กรุณาเลือกรายการก่อน --</option>'; return; }
    
    google.script.run.withSuccessHandler(function(r) {
      custSel.disabled = false;
      try {
        var res = JSON.parse(r);
        if (res.status === 'Success') {
          var nameArr = res.customers || [];
          custSel.innerHTML = '<option value="">-- เลือกลูกค้า (' + nameArr.length + ' คน) --</option>';
          nameArr.forEach(function(n) {
            var o = document.createElement('option'); o.value = n; o.textContent = n;
            custSel.appendChild(o);
          });
        } else { custSel.innerHTML = '<option value="">โหลดรายชื่อไม่สำเร็จ</option>'; }
      } catch(e) { custSel.innerHTML = '<option value="">เกิดข้อผิดพลาด</option>'; }
    }).adminGetCustomers(sid);
  };

  var resultHolder = document.createElement('div'); resultHolder.id = 'summaryResult';
  wrap.appendChild(resultHolder);
  el('content').innerHTML = ''; el('content').appendChild(wrap);

  // Trigger load if pre-selected
  if (selectedSheetId && selectedSheetId !== 'ALL') { setTimeout(function() { sel.onchange(); }, 100); }
}

function generateSummary() {
  // Grab the value back from the dropdown!
  var sheetId = el('summarySheetPicker').value;
  var customer = el('summaryCustomerName').value.trim();
  var sDate = el('sumStartDate').value;
  var eDate = el('sumEndDate').value;
  var fee = Number(el('sumDelFee').value) || 0;
  var prodGetDate = el('sumProdGetDate').value || 'จ-อ 22-23/12';
  var delDate1 = el('sumDelDate1').value || 'พ 24/12';
  var delDate2 = el('sumDelDate2').value || 'ส. 27/12';

  if (!sheetId) { toast('กรุณาเลือกรายการสั่งซื้อ', 'error'); return; }
  if (!customer) { toast('กรุณากรอกชื่อลูกค้า', 'error'); return; }
  
  el('summaryResult').innerHTML = ''; el('summaryResult').appendChild(makeSpinner());
  
  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') { el('summaryResult').innerHTML = ''; el('summaryResult').appendChild(div('state-empty', '&#x26A0;&#xFE0F; ' + escapeHtml(res.message))); return; }
      
      res.deliveryFee = fee;
      res.prodGetDate = prodGetDate;
      res.delDate1 = delDate1;
      res.delDate2 = delDate2;

      renderSummaryResult(res); 
    } catch(e) { el('summaryResult').innerHTML = ''; el('summaryResult').appendChild(div('state-empty', 'เกิดข้อผิดพลาด')); }
  }).adminGenerateCustomerSummary(sheetId, customer, sDate, eDate);
}

function renderSummaryResult(res) {
  var lines = res.orderLines || [];
  var fee = res.deliveryFee || 0;
  var totalToPay = res.remaining + fee;

  // --- CUSTOM TEMPLATE GENERATION ---
  var text = 'สวัสดีครับ~ 💌 รายการที่ตัวเองสั่งไว้กำลังเดินทางมาถึงไทยแล้วนะคะ! ด้านล่างนี้คือรายละเอียดรายการที่สั่งไว้ที่กำลังจะเข้าไทยค่ะ รบกวนเช็กชื่อและจำนวนสินค้าอีกทีนะคะ 😊\n\n';
  
  for (var i = 0; i < lines.length; i++) text += lines[i] + '\n';
  
  text += '\n📦 ค่าจัดส่ง + ' + fee + ' บาท\n\n';
  text += 'ยอดค้างชำระสินค้า ' + fmt(res.remaining) + ' + ค่าจัดส่ง ' + fee + ' บาท = ' + fmt(totalToPay) + '\n\n';
  text += '💸 ยอดโอนทั้งหมด ' + fmt(totalToPay) + ' ✅✅✅✅\n\n';
  
  if (res.totalYuan) {
    text += 'ยอดเงินหยวน ¥' + res.totalYuan + '\n\n';
  }
  
  // Inject the custom dates here!
  text += '***หากพรีสินค้าที่พรีไว้แล้วต้องการรอส่งพร้อมกันรบกวนแจ้งได้เลยนะคะ\n\n' +
          '🌟 ช่องทางการโอน\n\n' +
          '•TrueMoney : 080-292-7553\n\n' +
          '•กสิกรไทย : 094-8-44664-2\n\n' +
          '•ชื่อบัญชี : ปิยธิดา ก.\n\n' +
          '***หากสแกนด้วยบัตรเครดิตรบกวน+2% นะคะ\n\n' +
          '🗓 รอบจัดส่ง\n' +
          'สินค้าเข้าไม่เกินวัน ' + res.prodGetDate + '\n\n' +
          'รอบจัดส่ง (วันหลังของเข้า)\n' +
          'ร้านจัดส่งแค่ สัปดาห์ละ 2 วัน เท่านั้นนะคับ~\n\n' +
          '•โอนก่อน อ. 18:00 น. → ส่ง ' + res.delDate1 + '\n' +
          '•โอนหลัง อ. 18:00 น. เป็นต้นไป → ส่ง ' + res.delDate2 + '\n\n' +
          'หากสินค้าไม่เข้าตามเวลาที่คาดการจะแจ้งเลื่อนรอบอีกครั้งค่า\n\n' +
          '⏰) ⸻\n\n' +
          '🧾 หลังโอนแล้วอย่าลืมแจ้ง\n' +
          '• สลิปโอนเงิน\n' +
          '• ชื่อ-ที่อยู่\n' +
          '• เบอร์โทรศัพท์\n\n' +
          'เพื่อให้น้อง ๆ ได้ออกเดินทางไปหาอย่างถูกต้องน้าา 💕 ขอบคุณมาก ๆ เลยนะคะที่มารับน้อง ๆ ไปอยู่ด้วย 🧸✨ 💖';

  // --- RENDER UI ---
  var card = div('section-card');
  var hdr = div('section-card-header');
  hdr.appendChild(div('section-card-title', '&#x1F9FE; ผลลัพธ์: ' + escapeHtml(res.customerName)));
  hdr.appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; คัดลอก', function() {
    var ta = el('summaryText'); if (!ta) return; ta.select(); document.execCommand('copy'); toast('คัดลอกแล้ว!', 'success');
  }));
  card.appendChild(hdr);

  var ta = document.createElement('textarea'); ta.id = 'summaryText'; ta.readOnly = true;
  ta.style.cssText = 'width:100%;padding:14px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:0.85rem;font-family:var(--font);color:var(--text-2);line-height:1.9;resize:vertical;min-height:380px;background:var(--surface-2);outline:none;';
  ta.value = text; card.appendChild(ta);

  var statsRow = document.createElement('div'); statsRow.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:1.5px dashed var(--border);';
  function addStat2(label, value, color) {
    var s = document.createElement('div');
    var lb = document.createElement('div'); lb.style.cssText = 'font-size:0.7rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.05em;'; lb.textContent = label;
    var vl = document.createElement('div'); vl.style.cssText = 'font-size:1.1rem;font-weight:700;color:' + color + ';'; vl.textContent = value;
    s.appendChild(lb); s.appendChild(vl); statsRow.appendChild(s);
  }
  
  addStat2('ราคาเต็มรวม', fmt(res.totalFull), 'var(--text)');
  addStat2('มัดจำแล้ว', fmt(res.totalDeposit), 'var(--warning)');
  addStat2('ค่าจัดส่ง', '+ ' + fmt(fee), 'var(--text-2)');
  addStat2('ต้องชำระเพิ่ม', fmt(totalToPay), 'var(--error)');
  
  if (res.totalYuan) addStat2('หยวน', '¥' + res.totalYuan, 'var(--text-2)');
  card.appendChild(statsRow);

  el('summaryResult').innerHTML = ''; el('summaryResult').appendChild(card);
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
        if (res.status === 'Success') { closeModal(); toast('ลบสินค้าแล้ว', 'success'); loadStock(renderStockContent); }
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
          closeModal(); toast('ลบสินค้าแล้ว ' + (res.deleted || 0) + ' รายการ', 'success');
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
