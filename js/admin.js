// ── STATE ──
var allLists = [], selectedSheetId = null, selectedSheetName = '';
var currentPanel = 'overview', modalSaveFn = null;
var pendingImg = {};   // { fieldId: base64string }
var currentProductsSheetId = null;
var productViewMode = window.innerWidth <= 850 ? 'list' : 'grid';
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
loadAllLists(function() { switchPanel('orderlists'); });

// ── HELPERS ──
var _toastTimer = null;
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = (type || 'success') + ' show';
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function() { el.classList.remove('show'); _toastTimer = null; }, 3500);
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
    // Collect per-option barcodes
    var bcs = opts.map(function(_, i) {
      var inp2 = document.getElementById(fieldId + '_bc_' + i);
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

function makeBarcodeIdField(fieldId, currentVal, fullWidth) {
  // Uses sf-group styling to match stock form — caller wraps in sf-full if needed
  var f = document.createElement('div');
  f.className = 'sf-group sf-full';

  // Label row with scan button on right
  var labelRow = document.createElement('div');
  labelRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
  var lbl = document.createElement('label');
  lbl.htmlFor = fieldId;
  lbl.textContent = 'ID สินค้า *';
  var scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.innerHTML = '&#x1F4F7; สแกนบาร์โค้ด';
  scanBtn.className = 'sf-bc-btn cam';
  scanBtn.style.cssText += 'border-radius:999px;font-size:0.73rem;padding:4px 10px;';
  labelRow.appendChild(lbl);
  labelRow.appendChild(scanBtn);
  f.appendChild(labelRow);

  // Input + random button row
  var inputRow = document.createElement('div'); inputRow.className = 'sf-bc-row';
  var inp = document.createElement('input');
  inp.type = 'text'; inp.id = fieldId;
  inp.placeholder = 'สแกนหรือพิมพ์ ID (เช่น P001)';
  inp.value = currentVal || '';
  inp.addEventListener('input', function() {
    var v = inp.value.trim();
    if (v.length >= 4) generateBarcode(v, fieldId);
  });

  var randMainBtn = document.createElement('button');
  randMainBtn.type = 'button'; randMainBtn.className = 'sf-bc-btn';
  randMainBtn.innerHTML = '&#x1F3B2; สุ่ม';
  randMainBtn.onclick = function() {
    var rand7 = generateRandomBarcode();
    inp.value = rand7;
    generateBarcode(rand7, fieldId);
  };
  inputRow.appendChild(inp); inputRow.appendChild(randMainBtn);
  f.appendChild(inputRow);

  // Barcode preview — always visible, empty canvas until value entered
  var barcodeWrap = document.createElement('div');
  barcodeWrap.id = fieldId + '_barcode';
  barcodeWrap.className = 'bc-preview-wrap';
  // stays hidden until a barcode is actually rendered (generateBarcode shows it)

  var bcCanvas = document.createElement('canvas');
  bcCanvas.id = fieldId + '_canvas';
  barcodeWrap.appendChild(bcCanvas);
  f.appendChild(barcodeWrap);

  // ── SCAN button ──
  scanBtn.onclick = function() {
    scanBtn.innerHTML = '&#x23F9;&#xFE0F; รอสแกน...';
    scanBtn.disabled = true;

    var scanToken = 'barcode_result_' + fieldId + '_' + Date.now();

    function resetScanButton() {
      scanBtn.innerHTML = '&#x1F4F7; สแกนบาร์โค้ด';
      scanBtn.disabled = false;
    }

    function applyBarcodeResult(barcode) {
      barcode = String(barcode || '').trim();
      if (!barcode) return;

      var targetInput = document.getElementById(fieldId) || inp;

      targetInput.value = barcode;
      targetInput.setAttribute('value', barcode);

      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));

      toast('สแกนได้: ' + barcode, 'success');

      resetScanButton();

      setTimeout(function() {
        generateBarcode(barcode, fieldId);
      }, 200);
    }

    var popup = window.open(
      '',
      'barcode_scanner',
      'width=420,height=600,resizable=yes,scrollbars=no,toolbar=no,menubar=no'
    );

    if (!popup) {
      toast('กรุณาอนุญาต Pop-up สำหรับหน้านี้แล้วลองใหม่', 'error');
      resetScanButton();
      return;
    }

    // Direct bridge from popup back to this input
    window.__barcodeResultBridge = function(token, barcode) {
      if (token !== scanToken) return;
      applyBarcodeResult(barcode);

      try {
        if (popup && !popup.closed) popup.close();
      } catch(e) {}
    };

    var popupHtml = makeScannerPopupHtml(scanToken);

    popup.document.open();
    popup.document.write(popupHtml);
    popup.document.close();

    function onMessage(e) {
      var data = e.data || {};
      if (!data || data.token !== scanToken) return;

      var barcode = data.barcode || data.value || '';
      barcode = String(barcode || '').trim();

      if (barcode) {
        clearInterval(checkPopup);
        window.removeEventListener('message', onMessage);
        delete window.__barcodeResultBridge;
        applyBarcodeResult(barcode);
      }
    }

    window.addEventListener('message', onMessage);

    // Last fallback: parent reads a variable from the popup window
    var checkPopup = setInterval(function() {
      try {
        if (popup && !popup.closed && popup.__barcodeResult) {
          var result = String(popup.__barcodeResult || '').trim();
          if (result) {
            clearInterval(checkPopup);
            window.removeEventListener('message', onMessage);
            delete window.__barcodeResultBridge;
            applyBarcodeResult(result);
            popup.close();
            return;
          }
        }

        if (!popup || popup.closed) {
          clearInterval(checkPopup);
          window.removeEventListener('message', onMessage);
          delete window.__barcodeResultBridge;
          resetScanButton();
        }
      } catch(e) {
        clearInterval(checkPopup);
        window.removeEventListener('message', onMessage);
        delete window.__barcodeResultBridge;
        resetScanButton();
      }
    }, 250);
  };

  // Random barcode button handled inline above

  if (currentVal) {
    setTimeout(function() { generateBarcode(currentVal, fieldId); }, 300);
  }

  return f;
}

function makeScannerPopupHtml(scanToken) {
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
    '  <button id="cancelBtn">ยกเลิก</button>',
    '</div>',
    '<script>',
    'var scanner=null,hasScanned=false;',
    'var SCAN_TOKEN="' + scanToken + '";',
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
    '  if(scanner){try{scanner.stop();}catch(e){}}',
    '  setTimeout(function(){window.close();},700);',
    '}',
    'function startScanner(){',
    '  scanner=new Html5Qrcode("reader");',
    '  scanner.start(',
    '    {facingMode:"environment"},',
    '    {fps:15,disableFlip:true,',
    '     formatsToSupport:[',
    '       Html5QrcodeSupportedFormats.EAN_13,',
    '       Html5QrcodeSupportedFormats.EAN_8,',
    '       Html5QrcodeSupportedFormats.CODE_128,',
    '       Html5QrcodeSupportedFormats.CODE_39,',
    '       Html5QrcodeSupportedFormats.UPC_A,',
    '       Html5QrcodeSupportedFormats.UPC_E,',
    '       Html5QrcodeSupportedFormats.QR_CODE',
    '     ]},',
    '    function(text){sendResult(text);},',
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
  var items = document.querySelectorAll('.nav-item[data-panel]');
  for (var i = 0; i < items.length; i++) {
    items[i].className = items[i].getAttribute('data-panel') === panel ? 'nav-item active' : 'nav-item';
  }
  if (panel === 'orderlists') renderOrderLists();
  else if (panel === 'orders')     renderOrdersPanel();
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

function getVisibleLists() {
  var visible = allLists.filter(function(l) {
    var d = String(l.display).toLowerCase();
    return d !== 'hidden' && d !== 'hide' && d !== 'false' && d !== 'no'; 
  });
  
  visible.sort(function(a, b) {
    if (a.status === 'Open' && b.status !== 'Open') return -1;
    if (a.status !== 'Open' && b.status === 'Open') return 1;
    return 0; // Keeps original order for matching statuses
  });
  
  return visible;
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

// Downloads a restore-grade JSON of every table plus an Excel-friendly
// CSV of all orders (UTF-8 BOM so Thai text opens correctly in Excel)
function exportBackup(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังสำรอง...'; }
  function restoreBtn() { if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F4BE; สำรองข้อมูล'; } }
  google.script.run.withSuccessHandler(function(r) {
    restoreBtn();
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') { toast(res.message || 'สำรองข้อมูลไม่สำเร็จ', 'error'); return; }
      var d = res.data || {};
      var now = new Date();
      var stamp = now.getFullYear() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '-' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0');

      downloadTextFile('orderhub-backup-' + stamp + '.json',
        JSON.stringify({ exportedAt: res.exportedAt, data: d }, null, 1),
        'application/json');

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
      // Slight delay so browsers allow the second download
      setTimeout(function() {
        downloadTextFile('orderhub-orders-' + stamp + '.csv', '\uFEFF' + lines.join('\r\n'), 'text/csv');
      }, 500);

      toast('สำรองข้อมูลแล้ว: รายการ ' + (d.order_lists || []).length +
            ' / สินค้า ' + (d.products || []).length +
            ' / ออเดอร์ ' + (d.orders || []).length +
            ' / คลัง ' + (d.stock_items || []).length, 'success');
    } catch(e) { toast('สำรองข้อมูลไม่สำเร็จ', 'error'); }
  }).withFailureHandler(function() {
    restoreBtn();
    toast('สำรองข้อมูลไม่สำเร็จ — กรุณาลองใหม่', 'error');
  }).adminExportAllData();
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
  var bb = makeBtn('btn btn-ghost btn-sm', '&#x1F4BE; สำรองข้อมูล', function() { exportBackup(bb); });
  bb.title = 'ดาวน์โหลดข้อมูลทั้งหมด (JSON) + ออเดอร์ (CSV)';
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

function editOrderListRow(item) {
  el('modalBody').innerHTML = '';
  var canRename = !String(item.sourceSpreadsheetId || '').trim();
  // Lists created directly in the web app own their name. Imported lists keep
  // the spreadsheet title as their source of truth, so show it as read-only.
  var nf = div('modal-field'); var nl = document.createElement('label'); nl.textContent = 'ชื่อรายการ';
  var ni = document.createElement('input'); ni.id = 'mName'; ni.type = 'text'; ni.value = item.name || '';
  ni.readOnly = !canRename;
  if (!canRename) {
    ni.title = 'ชื่อรายการนี้มาจาก Google Sheet';
    ni.style.background = 'var(--surface-2)';
    var nameHelp = document.createElement('small');
    nameHelp.style.cssText = 'display:block;margin-top:5px;color:var(--text-3);';
    nameHelp.textContent = 'ชื่อรายการนี้เชื่อมกับ Google Sheet จึงแก้ไขจากหน้านี้ไม่ได้';
    nf.appendChild(nl); nf.appendChild(ni); nf.appendChild(nameHelp);
  } else {
    nf.appendChild(nl); nf.appendChild(ni);
  }
  el('modalBody').appendChild(nf);
  // Desc field
  var df = div('modal-field'); var dl = document.createElement('label'); dl.textContent = 'คำอธิบาย';
  var di = document.createElement('input'); di.id = 'mDesc'; di.type = 'text'; di.value = item.desc || '';
  df.appendChild(dl); df.appendChild(di); el('modalBody').appendChild(df);
  // Image uploader
  el('modalBody').appendChild(makeImageField('mImage', item.image || '', 'รูปภาพปก'));

  openModal('&#x270F;&#xFE0F; แก้ไขรายการสั่งซื้อ', '', function() {
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
            closeModal(); toast('บันทึกแล้ว', 'success');
            for (var i = 0; i < allLists.length; i++) {
              if (allLists[i].rowIndex === item.rowIndex) {
                if (newName !== null) allLists[i].name = newName;
                allLists[i].desc = d; allLists[i].image = finalImage; break;
              }
            }
            renderOrderLists();
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

  var tglWrap = document.createElement('div');
  tglWrap.style.cssText = 'display:flex; background:var(--surface-2); border:1.5px solid var(--border); border-radius:var(--radius-sm); padding:3px; gap:2px; min-width:240px;';
  
  var oBtn = makeBtn('btn btn-primary btn-sm', '&#x1F4CB; ตารางคำสั่งซื้อ', null);
  oBtn.style.cssText = 'flex:1; justify-content:center; border:none; pointer-events:none;'; 
  
  var sBtn = makeBtn('btn btn-ghost btn-sm', '&#x1F4DD; สร้างสรุปยอด', function() { switchPanel('summary'); });
  sBtn.style.cssText = 'flex:1; justify-content:center; border:none; background:transparent;';
  
  tglWrap.appendChild(oBtn); tglWrap.appendChild(sBtn);
  el('topbarActions').innerHTML = ''; el('topbarActions').appendChild(tglWrap);

  var wrap = document.createElement('div');

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
      renderOrdersTable(res.orders, holder, false);
    } catch(e) { holder.innerHTML = ''; holder.appendChild(div('state-empty', 'เกิดข้อผิดพลาด')); }
  }).adminGetOrders(sheetId);
}

function renderOrdersTable(orders, holder, isAllView) {
  holder.innerHTML = '';
  if (!orders || !orders.length) { holder.appendChild(div('state-empty', '&#x1F4ED; ยังไม่มีคำสั่งซื้อค่ะ')); return; }

  // Sort by timestamp descending so newest are at the top
  orders.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });

  var totalRev = 0, uCust = {}, totalItems = 0;
  for (var i = 0; i < orders.length; i++) {
    totalRev += Number(orders[i].total) || 0;
    uCust[orders[i].customer] = true;
    totalItems += Number(orders[i].qty) || 0;
  }

  var statRow = div('stat-row');
  statRow.appendChild(makeStat('คำสั่งซื้อ', orders.length, 'primary'));
  statRow.appendChild(makeStat('ลูกค้า', Object.keys(uCust).length, ''));
  statRow.appendChild(makeStat('ชิ้น', totalItems, ''));
  statRow.appendChild(makeStat('ยอดรวม', fmt(totalRev), 'success'));
  holder.appendChild(statRow);

  var card = div('section-card');
  var hdr = div('section-card-header');
  hdr.appendChild(div('section-card-title', '&#x1F9FE; รายการคำสั่งซื้อ'));

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
  searchInp.placeholder = 'ค้นหาชื่อลูกค้า / สินค้า.';
  searchInp.oninput = function() { filterOrderRows(this.value); };
  searchWrap.appendChild(searchInp);

  // Multi-select delete — only in single-list view (rowIndex maps to that list's orders)
  var delSelBtn = null;
  if (!isAllView) {
    delSelBtn = makeBtn('btn btn-danger btn-sm', '&#x1F5D1; ลบที่เลือก', function() { confirmDeleteSelectedOrders(); });
    delSelBtn.id = 'orderDelSelBtn';
    delSelBtn.style.display = 'none';
    rightWrap.appendChild(delSelBtn);
  }
  rightWrap.appendChild(openShopBtn);
  rightWrap.appendChild(searchWrap);

  hdr.appendChild(rightWrap);
  card.appendChild(hdr);

  var scrollWrap = document.createElement('div'); scrollWrap.style.overflowX = 'auto';
  var tbl = document.createElement('table'); tbl.className = 'data-table'; tbl.id = 'ordersDataTable';

  var selTh = isAllView ? '' : '<th style="width:34px;"><input type="checkbox" id="orderSelAll" aria-label="เลือกคำสั่งซื้อทั้งหมด" style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;"></th>';
  var shopTh = isAllView ? '<th>ร้านค้า</th>' : '';
  tbl.innerHTML = '<thead><tr>' + selTh + '<th>วันที่</th>' + shopTh + '<th>ลูกค้า</th><th>สินค้า</th><th style="text-align:center;">จำนวน</th><th style="text-align:center;">ประเภท</th><th style="text-align:center;">ราคา/ชิ้น</th><th style="text-align:center;">รวม</th><th style="text-align:center;">เบอร์</th></tr></thead>';
  var tbody = document.createElement('tbody');
  
  // Helper to format the raw Date string into a readable format
  function formatDate(dStr) {
    if (!dStr) return '—';
    var d = new Date(dStr);
    if (isNaN(d.getTime())) return dStr; 
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  for (var j = 0; j < orders.length; j++) {
    var o = orders[j];
    var tr = document.createElement('tr'); 
    tr.setAttribute('data-search', (o.customer + ' ' + o.product + (o.shopName || '')).toLowerCase());
    var isDeposit = o.payType === 'Deposit';
    
    var cells = [];

    if (!isAllView) {
      cells.push({html: '<input type="checkbox" class="order-sel" data-row="' + o.rowIndex + '" aria-label="เลือกคำสั่งซื้อของ ' + escapeHtml(o.customer) + '" style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;">', style: 'text-align:center;'});
    }

    cells.push(
      {text: formatDate(o.timestamp), style: 'font-size:0.75rem;color:var(--text-3);white-space:nowrap;'}
    );

    if (isAllView) {
      cells.push({text: o.shopName || '', style: 'font-size:0.75rem; color:var(--primary); font-weight:600; white-space:nowrap;'});
    }

    cells.push(
      {text: o.customer, style: 'font-weight:600;'},
      {text: o.product, style: ''},
      {text: o.qty, style: 'text-align:center;'},
      {html: '<span class="badge ' + (isDeposit ? 'badge-deposit' : 'badge-full') + '">' + escapeHtml(o.payType) + '</span>', style: 'text-align:center;'},
      {text: fmt(o.price), style: 'text-align:center;'},
      {text: fmt(o.total), style: 'text-align:center;font-weight:700;color:var(--primary);'},
      {text: o.remark || '—', style: 'text-align:center;font-size:0.75rem;color:var(--text-3);'}
    );

    for (var k = 0; k < cells.length; k++) {
      var td = document.createElement('td');
      if (cells[k].style) td.style.cssText = cells[k].style;
      if (cells[k].html) td.innerHTML = cells[k].html; else td.textContent = cells[k].text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tbl.appendChild(tbody); scrollWrap.appendChild(tbl); card.appendChild(scrollWrap); holder.appendChild(card);

  if (!isAllView) {
    var refreshDelBtn = function() {
      var n = tbl.querySelectorAll('.order-sel:checked').length;
      if (delSelBtn) {
        delSelBtn.style.display = n ? '' : 'none';
        delSelBtn.innerHTML = '&#x1F5D1; ลบที่เลือก (' + n + ')';
      }
    };
    tbl.addEventListener('change', function(e) {
      if (e.target.id === 'orderSelAll') {
        // Select-all only applies to rows visible under the current search filter
        tbl.querySelectorAll('tbody tr').forEach(function(tr) {
          if (tr.style.display === 'none') return;
          var cb = tr.querySelector('.order-sel');
          if (cb) cb.checked = e.target.checked;
        });
        refreshDelBtn();
      } else if (e.target.classList.contains('order-sel')) {
        refreshDelBtn();
      }
    });
  }
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
  var rows = document.querySelectorAll('#ordersDataTable tbody tr');
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
    var addBtn = makeBtn('btn btn-primary', '&#x2B; เพิ่มสินค้าชิ้นแรก', openCreateProductModal);
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
  hdrRight.appendChild(makeBtn('btn btn-primary btn-sm', '&#x2B; เพิ่มสินค้า', openCreateProductModal));
  hdrRight.appendChild(makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; เพิ่มหลายรายการ', openBulkAddModal));
  hdrRight.appendChild(makeBtn('btn btn-success btn-sm', '&#x2713; บันทึกสต็อก', saveAllStock));
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
      if (p.sourceStockItemId && p.remaining !== null && p.remaining > 0) {
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
    // 2. GRID VIEW (New Design)
    var grid = div('prod-grid');
    for (var j = 0; j < products.length; j++) {
      var pGrid = products[j];
      var isGridOpen = pGrid.status === 'Open';
      var remGridVal = (pGrid.remaining === null || pGrid.remaining === undefined) ? '' : pGrid.remaining;
      
      var pCard = div('prod-card');
      
      // Handle Image fallback
      var pIW = div('prod-card-img-wrap');
      if (pGrid.image) { var pImg = document.createElement('img'); pImg.src = pGrid.image; pImg.onerror = function() { this.src = PLACEHOLDER; }; pIW.appendChild(pImg); }
      else { pIW.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'; }
      pCard.appendChild(pIW);
      var pBdy = div('prod-card-body');
      var pTt = div('prod-card-title'); pTt.textContent = pGrid.name; pBdy.appendChild(pTt);
      if (pGrid.options) { var pSub = div('prod-card-subtitle'); pSub.textContent = 'ตัวเลือก: ' + pGrid.options; pBdy.appendChild(pSub); }
      var pPr = div('prod-card-price'); pPr.textContent = fmt(pGrid.price);
      var pDep = div('prod-card-deposit'); pDep.textContent = 'มัดจำ: ' + fmt(pGrid.deposit); pPr.appendChild(pDep); pBdy.appendChild(pPr);
      var pAct = div('prod-card-actions');
      // Row 1: [select] [stock input] [open/closed toggle]
      var pRow1 = document.createElement('div');
      pRow1.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var pSel = document.createElement('input');
      pSel.type = 'checkbox'; pSel.className = 'prod-sel';
      pSel.setAttribute('data-row', pGrid.rowIndex);
      pSel.setAttribute('aria-label', 'เลือก ' + pGrid.name);
      pRow1.appendChild(pSel);
      var pSL = document.createElement('span'); pSL.style.cssText = 'font-size:0.75rem;font-weight:600;color:var(--text-2);white-space:nowrap;'; pSL.textContent = 'สต็อก';
      var pSI = document.createElement('input'); pSI.type = 'number'; pSI.min = '0'; pSI.className = 'stock-input';
      pSI.id = 'stock-' + pGrid.rowIndex; pSI.value = remGridVal; pSI.placeholder = '∞';
      pSI.setAttribute('data-row', pGrid.rowIndex); pSI.setAttribute('data-shid', sheetId);
      pSI.style.cssText = 'flex:1;min-width:0;width:auto;';
      pRow1.appendChild(pSL); pRow1.appendChild(pSI);
      var pTL = document.createElement('label'); pTL.className = 'toggle'; pTL.title = 'เปิด/ปิดขาย';
      var pCk = document.createElement('input'); pCk.type = 'checkbox'; pCk.className = 'prod-tog';
      pCk.setAttribute('data-row', pGrid.rowIndex); pCk.setAttribute('data-shid', sheetId); if (isGridOpen) pCk.checked = true;
      var pSld = document.createElement('span'); pSld.className = 'toggle-slider';
      pTL.appendChild(pCk); pTL.appendChild(pSld); pRow1.appendChild(pTL);
      pAct.appendChild(pRow1);

      // Row 2: action buttons, right-aligned with room to breathe
      var pRow2 = document.createElement('div');
      pRow2.style.cssText = 'display:flex;align-items:center;justify-content:flex-end;gap:6px;';
      var pEB = makeBtn('btn-icon prod-edit', SVG_EDIT); pEB.title = 'แก้ไข'; pEB.setAttribute('data-row', pGrid.rowIndex); pRow2.appendChild(pEB);
      if (pGrid.sourceStockItemId && pGrid.remaining !== null && pGrid.remaining > 0) {
        var pRB = makeBtn('btn-icon prod-return', '&#x21A9;'); pRB.title = 'คืนสต็อกเข้าคลัง'; pRB.setAttribute('data-row', pGrid.rowIndex); pRB.setAttribute('data-name', pGrid.name); pRow2.appendChild(pRB);
      }
      var pDB = makeBtn('btn-icon prod-del', SVG_TRASH); pDB.title = 'ลบ'; pDB.setAttribute('data-row', pGrid.rowIndex); pDB.setAttribute('data-name', pGrid.name); pDB.style.cssText = 'color:var(--error);border-color:var(--error);'; pRow2.appendChild(pDB);
      pAct.appendChild(pRow2);

      pBdy.appendChild(pAct); pCard.appendChild(pBdy);
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
function confirmReturnStock(sheetId, rowIndex, name) {
  var prod = currentProductsCache.find(function(p) { return p.rowIndex === rowIndex; });
  var qty = prod && prod.remaining !== null ? Number(prod.remaining) : 0;
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
    if (p && p.sourceStockItemId && Number(p.remaining) > 0) { eligible++; pieces += Number(p.remaining); }
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
    if (p.sourceStockItemId && Number(p.remaining) > 0) { eligible++; pieces += Number(p.remaining); }
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

// ════════════════════════════════
// CREATE PRODUCT
// ════════════════════════════════

// ════════════════════════════════════════════════════════════
// BULK ADD PRODUCTS
// Fill a table of products, then save all at once.
// Images can be added later via edit, or pasted/dragged per row.
// ════════════════════════════════════════════════════════════
// ── Shared image pick box for bulk add modals ──
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

function openBulkAddModal() {
  if (!currentProductsSheetId) { toast('กรุณาเลือกรายการสั่งซื้อก่อน', 'error'); return; }

  // Bulk rows state
  var bulkRows = [makeBulkRow()];

  // ── Row data model ──
  function makeBulkRow(data) {
    return {
      name:    (data && data.name)    || '',
      price:   (data && data.price)   || '',
      deposit: (data && data.deposit) || '',
      yuan:    (data && data.yuan)    || '',
      stock:   (data && data.stock)   || '',
      id:      (data && data.id)      || generateRandomBarcode(),
      image:   (data && data.image)   || '',
      mode:    (data && data.mode)    || 'single', // 'single' | 'options'
      opts:    (data && data.opts)    || [],        // [{name, id, image}]
      status:  'pending'
    };
  }
  function makeBulkOpt() { return { name: '', id: generateRandomBarcode(), image: '', pendingKey: '', stock: '' }; }

  // ── Reusable image pick box (no URL field) ──
  function buildBulkUI() {
    el('modalBody').innerHTML = '';

    var intro = document.createElement('div');
    intro.style.cssText = 'font-size:0.8rem;color:var(--text-3);margin-bottom:12px;line-height:1.5;';
    intro.innerHTML = '📋 เพิ่มสินค้าหลายรายการพร้อมกัน — แต่ละรายการเลือกได้ว่าเป็นสินค้าเดียวหรือมีตัวเลือก';
    el('modalBody').appendChild(intro);

    var bulkList = document.createElement('div');
    bulkList.id = 'bulkList';
    bulkList.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:10px;';
    el('modalBody').appendChild(bulkList);
    renderBulkRows(bulkList);

    var addRowBtn = document.createElement('button');
    addRowBtn.type = 'button'; addRowBtn.className = 'add-opt-btn';
    addRowBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> เพิ่มสินค้า';
    addRowBtn.style.marginBottom = '6px';
    addRowBtn.onclick = function() { bulkRows.push(makeBulkRow()); var bl2 = document.getElementById('bulkList'); if (bl2) renderBulkRows(bl2); };
    el('modalBody').appendChild(addRowBtn);
  }

  function renderBulkRows(container) {
    container.innerHTML = '';
    bulkRows.forEach(function(row, idx) {

      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:0;overflow:hidden;transition:border-color 0.15s;';
      if (row.status === 'done')  card.style.borderColor = 'var(--success)';
      if (row.status === 'error') card.style.borderColor = 'var(--error)';

      // ── Card header ──
      var chdr = document.createElement('div');
      chdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);';
      var leftHdr = document.createElement('div'); leftHdr.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var cnum = document.createElement('span');
      cnum.style.cssText = 'font-size:0.72rem;font-weight:800;color:var(--primary);text-transform:uppercase;';
      cnum.textContent = 'สินค้า #' + (idx + 1);
      if (row.status === 'saving') cnum.innerHTML += ' <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:4px;"></span>';
      else if (row.status === 'done')  cnum.innerHTML += ' <span style="color:var(--success);margin-left:4px;">✓</span>';
      else if (row.status === 'error') cnum.innerHTML += ' <span style="color:var(--error);margin-left:4px;">✗</span>';
      leftHdr.appendChild(cnum);

      // Mode toggle pill
      var tog = document.createElement('div');
      tog.style.cssText = 'display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px;gap:1px;';
      function mkTog(label, mode) {
        var b = document.createElement('button'); b.type = 'button';
        b.textContent = label;
        b.style.cssText = 'border:none;border-radius:999px;padding:3px 10px;font-size:0.7rem;font-weight:700;font-family:var(--font);cursor:pointer;transition:all 0.15s;' +
          (row.mode === mode ? 'background:var(--primary);color:#fff;' : 'background:transparent;color:var(--text-3);');
        b.onclick = function() { row.mode = mode; if (mode === 'options' && !row.opts.length) row.opts.push(makeBulkOpt()); var bl = document.getElementById('bulkList'); if (bl) renderBulkRows(bl); };
        return b;
      }
      tog.appendChild(mkTog('🏷 เดียว', 'single'));
      tog.appendChild(mkTog('🎨 ตัวเลือก', 'options'));
      leftHdr.appendChild(tog);

      var cdelBtn = document.createElement('button'); cdelBtn.type = 'button'; cdelBtn.innerHTML = '×';
      cdelBtn.style.cssText = 'background:none;border:none;color:var(--text-3);font-size:1.2rem;cursor:pointer;padding:0 2px;line-height:1;';
      cdelBtn.onclick = function() { if (bulkRows.length > 1) { bulkRows.splice(idx, 1); var bl = document.getElementById('bulkList'); if (bl) renderBulkRows(bl); } };
      chdr.appendChild(leftHdr); chdr.appendChild(cdelBtn); card.appendChild(chdr);

      // ── Card body ──
      var body = document.createElement('div'); body.style.cssText = 'padding:12px 14px;';

      // Product image + name row (top section)
      var topRow = document.createElement('div'); topRow.style.cssText = 'display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;';
      // Image box (large, tap to pick)
      var imgPKey = 'bulk_img_' + idx;
      var imgB = makeBulkImgBox(imgPKey, row.image && !row.image.startsWith('__pending__') ? row.image : '', function(v) { row.image = v; });
      imgB.el.title = 'แตะเพื่อเลือกรูปหรือถ่ายรูป';
      topRow.appendChild(imgB.el);
      // Name input
      var nameGrp = document.createElement('div'); nameGrp.style.cssText = 'flex:1;min-width:0;';
      var nameLbl = document.createElement('label'); nameLbl.textContent = 'ชื่อสินค้า *';
      nameLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
      var nameInp = document.createElement('input'); nameInp.type = 'text';
      nameInp.value = row.name || ''; nameInp.placeholder = 'เช่น Acrylic Stand A';
      nameInp.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:0.88rem;font-family:var(--font);background:var(--surface-2);outline:none;';
      nameInp.onfocus = function() { nameInp.style.borderColor = 'var(--primary)'; };
      nameInp.onblur  = function() { nameInp.style.borderColor = 'var(--border)'; };
      nameInp.oninput = function() { row.name = nameInp.value; };
      nameGrp.appendChild(nameLbl); nameGrp.appendChild(nameInp);
      topRow.appendChild(nameGrp);
      body.appendChild(topRow);

      // Price grid
      var pg = document.createElement('div'); pg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';
      function mkPriceInp(key, label, placeholder, isNum) {
        var g = document.createElement('div');
        var l = document.createElement('label'); l.textContent = label;
        l.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
        var i = document.createElement('input'); i.type = isNum ? 'number' : 'text';
        i.value = row[key] || ''; i.placeholder = placeholder || '';
        i.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.82rem;font-family:var(--font);background:var(--surface-2);outline:none;';
        i.onfocus = function() { i.style.borderColor = 'var(--primary)'; };
        i.onblur  = function() { i.style.borderColor = 'var(--border)'; };
        i.oninput = function() { row[key] = i.value; };
        g.appendChild(l); g.appendChild(i); pg.appendChild(g);
      }
      mkPriceInp('price', 'ราคาเต็ม (฿)', '0', true);
      mkPriceInp('deposit', 'ราคามัดจำ (฿)', '0', true);
      mkPriceInp('yuan', 'ราคาหยวน (¥)', '0', true);
      if (row.mode === 'single') mkPriceInp('stock', 'สต็อก', 'ว่าง=∞', true);
      body.appendChild(pg);

      // ID row (single mode only — options have their own barcodes)
      if (row.mode === 'single') {
        var idGrp = document.createElement('div'); idGrp.style.marginBottom = '10px;';
        var idLbl = document.createElement('label'); idLbl.textContent = 'ID / บาร์โค้ด *';
        idLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
        var idRowDiv = document.createElement('div'); idRowDiv.style.cssText = 'display:flex;gap:6px;align-items:center;';
        var idInp = document.createElement('input'); idInp.type = 'text';
        idInp.value = row.id || ''; idInp.placeholder = 'สแกนหรือพิมพ์บาร์โค้ด';
        idInp.style.cssText = 'flex:1;border:1.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:0.85rem;font-family:monospace;background:var(--surface-2);outline:none;min-width:0;';
        idInp.onfocus = function() { idInp.style.borderColor = 'var(--primary)'; };
        idInp.onblur  = function() { idInp.style.borderColor = 'var(--border)'; };
        idInp.oninput = function() { row.id = idInp.value; };
        var bcScanBtnB = document.createElement('button'); bcScanBtnB.type = 'button'; bcScanBtnB.innerHTML = '📷';
        bcScanBtnB.style.cssText = 'padding:7px 10px;border:1.5px solid var(--primary);border-radius:8px;background:var(--primary-light);color:var(--primary);font-size:0.8rem;cursor:pointer;flex-shrink:0;';
        bcScanBtnB.onclick = (function(inp, btn) { return function() {
          var tok = 'bk_bc_' + Date.now(); var pop = window.open('','bk_bc_' + idx,'width=420,height=600,resizable=yes');
          if (!pop) { toast('กรุณาอนุญาต Pop-up','error'); return; }
          btn.innerHTML = '⏹'; btn.disabled = true;
          function rst() { btn.innerHTML = '📷'; btn.disabled = false; }
          window.__barcodeResultBridge = function(t,bc){ if(t!==tok) return; inp.value=bc; row.id=bc; delete window.__barcodeResultBridge; rst(); try{if(pop&&!pop.closed)pop.close();}catch(e){} };
          pop.document.open(); pop.document.write(makeScannerPopupHtml(tok)); pop.document.close();
          var ck=setInterval(function(){ try{ if(pop&&!pop.closed&&pop.__barcodeResult){var rv=pop.__barcodeResult;clearInterval(ck);delete window.__barcodeResultBridge;inp.value=rv;row.id=rv;rst();pop.close();return;} if(!pop||pop.closed){clearInterval(ck);delete window.__barcodeResultBridge;rst();} }catch(e2){clearInterval(ck);rst();} },250);
        }; })(idInp, bcScanBtnB);
        var randBtnB = document.createElement('button'); randBtnB.type = 'button'; randBtnB.innerHTML = '🎲';
        randBtnB.style.cssText = 'padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-2);font-size:0.8rem;cursor:pointer;flex-shrink:0;';
        randBtnB.onclick = function() { row.id = generateRandomBarcode(); idInp.value = row.id; };
        idRowDiv.appendChild(idInp); idRowDiv.appendChild(bcScanBtnB); idRowDiv.appendChild(randBtnB);
        idGrp.appendChild(idLbl); idGrp.appendChild(idRowDiv); body.appendChild(idGrp);
      }

      // Options section (options mode)
      if (row.mode === 'options') {
        var optSep = document.createElement('hr'); optSep.style.cssText = 'border:none;border-top:1px solid var(--border);margin:6px 0 10px;';
        body.appendChild(optSep);
        var optHdr = document.createElement('div'); optHdr.style.cssText = 'font-size:0.72rem;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;';
        optHdr.textContent = 'ตัวเลือกสินค้า';
        body.appendChild(optHdr);

        var optList = document.createElement('div'); optList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

        row.opts.forEach(function(opt, oi) {
          var oc = document.createElement('div');
          oc.className = 'opt-card'; oc.style.cssText = 'padding:10px 12px;';

          var ohdr = document.createElement('div'); ohdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
          var olbl = document.createElement('span'); olbl.className = 'opt-card-label opt-badge';
          olbl.textContent = 'ตัวเลือก ' + (oi + 1 < 10 ? '0' + (oi + 1) : oi + 1);
          var odel = document.createElement('button'); odel.type = 'button'; odel.innerHTML = '×';
          odel.className = 'opt-card-del';
          odel.onclick = (function(row, oi2) { return function() { row.opts.splice(oi2, 1); var bl = document.getElementById('bulkList'); if (bl) renderBulkRows(bl); }; })(row, oi);
          ohdr.appendChild(olbl); ohdr.appendChild(odel); oc.appendChild(ohdr);

          // Name row — no option image: shop products only store
          // "name:barcode", so uploaded option images were discarded
          var oTop = document.createElement('div'); oTop.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;';
          var oNameGrp = document.createElement('div'); oNameGrp.style.cssText = 'flex:1;min-width:0;';
          var oNLbl = document.createElement('label'); oNLbl.textContent = 'ชื่อตัวเลือก';
          oNLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oNInp = document.createElement('input'); oNInp.type = 'text'; oNInp.value = opt.name || ''; oNInp.placeholder = 'เช่น สีแดง, Size M';
          oNInp.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.85rem;font-family:var(--font);background:var(--surface);outline:none;';
          oNInp.onfocus = function() { oNInp.style.borderColor = 'var(--primary)'; }; oNInp.onblur = function() { oNInp.style.borderColor = 'var(--border)'; };
          oNInp.oninput = function() { opt.name = oNInp.value; };
          oNameGrp.appendChild(oNLbl); oNameGrp.appendChild(oNInp); oTop.appendChild(oNameGrp);
          oc.appendChild(oTop);

          // Barcode row
          var oBcGrp = document.createElement('div');
          var oBcLbl = document.createElement('label'); oBcLbl.textContent = 'บาร์โค้ด';
          oBcLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oBcRow = document.createElement('div'); oBcRow.style.cssText = 'display:flex;gap:6px;';
          var oBcInp = document.createElement('input'); oBcInp.type = 'text'; oBcInp.value = opt.id || ''; oBcInp.placeholder = 'บาร์โค้ดตัวเลือกนี้';
          oBcInp.style.cssText = 'flex:1;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.82rem;font-family:monospace;background:var(--surface);outline:none;min-width:0;';
          oBcInp.onfocus = function() { oBcInp.style.borderColor = 'var(--primary)'; }; oBcInp.onblur = function() { oBcInp.style.borderColor = 'var(--border)'; };
          oBcInp.oninput = function() { opt.id = oBcInp.value; };
          // Scan btn
          var oBcScan = document.createElement('button'); oBcScan.type = 'button'; oBcScan.innerHTML = '📷';
          oBcScan.style.cssText = 'padding:6px 9px;border:1.5px solid var(--primary);border-radius:8px;background:var(--primary-light);color:var(--primary);font-size:0.78rem;cursor:pointer;flex-shrink:0;';
          oBcScan.onclick = (function(inp, btn) { return function() {
            var tok = 'bkopt_bc_' + Date.now(); var pop = window.open('','bkopt_' + idx + '_' + oi,'width=420,height=600,resizable=yes');
            if (!pop) { toast('กรุณาอนุญาต Pop-up','error'); return; }
            btn.innerHTML='⏹'; btn.disabled=true;
            function rst2(){btn.innerHTML='📷';btn.disabled=false;}
            window.__barcodeResultBridge=function(t,bc){if(t!==tok)return;inp.value=bc;opt.id=bc;delete window.__barcodeResultBridge;rst2();try{if(pop&&!pop.closed)pop.close();}catch(e){}};
            pop.document.open();pop.document.write(makeScannerPopupHtml(tok));pop.document.close();
            var ck2=setInterval(function(){try{if(pop&&!pop.closed&&pop.__barcodeResult){var rv=pop.__barcodeResult;clearInterval(ck2);delete window.__barcodeResultBridge;inp.value=rv;opt.id=rv;rst2();pop.close();return;}if(!pop||pop.closed){clearInterval(ck2);delete window.__barcodeResultBridge;rst2();}}catch(e2){clearInterval(ck2);rst2();}},250);
          }; })(oBcInp, oBcScan);
          // Random
          var oBcRand = document.createElement('button'); oBcRand.type = 'button'; oBcRand.innerHTML = '🎲';
          oBcRand.style.cssText = 'padding:6px 9px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-2);font-size:0.78rem;cursor:pointer;flex-shrink:0;';
          oBcRand.onclick = function() { opt.id = nextBarcodeFromPrevious(row.opts[oi > 0 ? oi - 1 : 0].id || ''); oBcInp.value = opt.id; };
          oBcRow.appendChild(oBcInp); oBcRow.appendChild(oBcScan); oBcRow.appendChild(oBcRand);
          oBcGrp.appendChild(oBcLbl); oBcGrp.appendChild(oBcRow); oc.appendChild(oBcGrp);

          // Stock input per option
          var oStockGrp = document.createElement('div'); oStockGrp.style.marginTop = '8px';
          var oStockLbl = document.createElement('label'); oStockLbl.textContent = 'สต็อก (ว่าง = ไม่จำกัด)';
          oStockLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oStockInp = document.createElement('input'); oStockInp.type = 'number'; oStockInp.min = '0';
          oStockInp.value = opt.stock !== undefined && opt.stock !== '' ? opt.stock : '';
          oStockInp.placeholder = 'ว่าง = ไม่จำกัด';
          oStockInp.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.85rem;font-family:var(--font);background:var(--surface);outline:none;';
          oStockInp.onfocus = function() { oStockInp.style.borderColor = 'var(--primary)'; }; oStockInp.onblur = function() { oStockInp.style.borderColor = 'var(--border)'; };
          oStockInp.oninput = function() { opt.stock = oStockInp.value; };
          oStockGrp.appendChild(oStockLbl); oStockGrp.appendChild(oStockInp); oc.appendChild(oStockGrp);

          optList.appendChild(oc);
        });
        body.appendChild(optList);

        // Add option btn
        var addOptBtn = document.createElement('button'); addOptBtn.type = 'button';
        addOptBtn.style.cssText = 'width:100%;margin-top:8px;padding:8px;border:1.5px dashed var(--border-strong);border-radius:10px;background:transparent;color:var(--text-3);font-size:0.8rem;font-weight:700;font-family:var(--font);cursor:pointer;';
        addOptBtn.innerHTML = '+ เพิ่มตัวเลือก';
        addOptBtn.onmouseenter = function() { addOptBtn.style.borderColor = 'var(--primary)'; addOptBtn.style.color = 'var(--primary)'; };
        addOptBtn.onmouseleave = function() { addOptBtn.style.borderColor = 'var(--border-strong)'; addOptBtn.style.color = 'var(--text-3)'; };
        addOptBtn.onclick = (function(row) { return function() { row.opts.push(makeBulkOpt()); var bl = document.getElementById('bulkList'); if (bl) renderBulkRows(bl); }; })(row);
        body.appendChild(addOptBtn);
      }

      card.appendChild(body);
      container.appendChild(card);
    });
  }

  buildBulkUI();

  openModal('📋 เพิ่มสินค้าหลายรายการ', '', function() {
    // Validate
    var valid = true;
    bulkRows.forEach(function(r, i) {
      if (!r.name.trim()) { toast('สินค้า ' + (i+1) + ': กรุณากรอกชื่อสินค้า', 'error'); valid = false; }
      if (r.mode === 'single' && !r.id.trim()) { toast('สินค้า ' + (i+1) + ': กรุณากรอก ID / บาร์โค้ด', 'error'); valid = false; }
      if (r.mode === 'options' && (!r.opts || !r.opts.length)) { toast('สินค้า ' + (i+1) + ': กรุณาเพิ่มตัวเลือกอย่างน้อย 1 รายการ', 'error'); valid = false; }
    });
    if (!valid) return;

    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...';
    var pending = bulkRows.length;
    var savedCount = 0;

    bulkRows.forEach(function(row, idx) {
      row.status = 'saving';
      var bl0 = document.getElementById('bulkList'); if (bl0) renderBulkRows(bl0);

      function doSaveRow(imgUrl, resolvedOpts) {
        // Build options string BEFORE the google.script.run chain
        var optsStr = '';
        if (row.mode === 'options' && resolvedOpts && resolvedOpts.length) {
          optsStr = resolvedOpts.map(function(o) {
            var n = (o.name || '').trim(), id2 = (o.id || '').trim();
            return id2 ? n + ':' + id2 : n;
          }).join(',');
        }
        var finalId    = row.mode === 'single' ? row.id.trim() : '';
        // Shop products track one stock pool: for option products use the
        // sum of the per-option amounts (all blank = unlimited)
        var finalStock = '';
        if (row.mode === 'single') {
          finalStock = row.stock.trim() || '';
        } else if (resolvedOpts && resolvedOpts.length) {
          var allHave = resolvedOpts.every(function(o) { return String(o.stock || '').trim() !== ''; });
          if (allHave) {
            finalStock = resolvedOpts.reduce(function(s, o) { return s + (Number(o.stock) || 0); }, 0);
          }
        }

        google.script.run
          .withSuccessHandler(function(r) {
            try { var res = JSON.parse(r); row.status = res.status === 'Success' ? 'done' : 'error'; if (res.status === 'Success') savedCount++; } catch(e) { row.status = 'error'; }
            pending--;
            var bl3 = document.getElementById('bulkList'); if (bl3) renderBulkRows(bl3);
            if (pending === 0) {
              saveBtn.disabled = false; saveBtn.textContent = 'บันทึกทั้งหมด';
              toast('บันทึกแล้ว ' + savedCount + '/' + bulkRows.length + ' รายการ', savedCount === bulkRows.length ? 'success' : 'error');
              if (savedCount === bulkRows.length) setTimeout(function() { closeModal(); loadProducts(currentProductsSheetId); }, 800);
            }
          })
          .withFailureHandler(function() {
            row.status = 'error'; pending--;
            var bl4 = document.getElementById('bulkList'); if (bl4) renderBulkRows(bl4);
            if (pending === 0) { saveBtn.disabled = false; saveBtn.textContent = 'บันทึกทั้งหมด'; }
          })
          .adminCreateProduct(currentProductsSheetId,
              finalId, row.name.trim(), imgUrl || '',
              Number(row.price) || 0, Number(row.deposit) || 0,
              finalStock, Number(row.yuan) || 0, optsStr);
      }

      // Only the main product image is uploaded — shop product options
      // are "name:barcode" text and cannot store images
      var pendingKey = 'bulk_img_' + idx;

      function resolveOptsAndSave(mainImgUrl) {
        doSaveRow(mainImgUrl, row.opts || []);
      }

      if (pendingImg[pendingKey]) {
        var b64 = pendingImg[pendingKey];
        google.script.run
          .withSuccessHandler(function(r) {
            delete pendingImg[pendingKey]; var url = '';
            try { var res = JSON.parse(r); if (res.status === 'Success') url = res.url; } catch(ex) {}
            resolveOptsAndSave(url);
          })
          .withFailureHandler(function() { delete pendingImg[pendingKey]; resolveOptsAndSave(''); })
          .adminUploadImage(b64);
      } else {
        resolveOptsAndSave(row.image && !row.image.startsWith('__pending__') ? row.image.trim() : '');
      }
    });
  }, 'บันทึกทั้งหมด');

  // Card layout — no modal widening needed

  el('modal').classList.add('open');
}

function openCreateProductModal() {
  if (!currentProductsSheetId) { toast('กรุณาเลือกรายการสั่งซื้อก่อน', 'error'); return; }
  el('modalBody').innerHTML = '';
  var grid = document.createElement('div'); grid.className = 'sf-grid'; el('modalBody').appendChild(grid);

  function addField(id, label, type, placeholder, fullWidth) {
    var f = document.createElement('div'); f.className = 'sf-group' + (fullWidth ? ' sf-full' : '');
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    var i = document.createElement('input'); i.id = id; i.type = type || 'text'; if (placeholder) i.placeholder = placeholder;
    f.appendChild(l); f.appendChild(i); grid.appendChild(f);
  }

  addField('pName', 'ชื่อสินค้า *', 'text', 'เช่น Acrylic Stand A', true);
  addField('pPrice', 'ราคาเต็ม (฿)', 'number', '0', false);
  addField('pDeposit', 'ราคามัดจำ (฿)', 'number', '0', false);
  addField('pRemaining', 'สต็อก', 'number', 'เว้นว่าง = ไม่จำกัด', false);
  addField('pYuan', 'ราคาหยวน (¥)', 'number', '0', false);

  // ── ID field with barcode scan + auto-render ──
  grid.appendChild(makeBarcodeIdField('pId', '', true));

  var imgWrap = document.createElement('div'); imgWrap.className = 'sf-group sf-full';
  imgWrap.appendChild(makeImageField('pImage', '', 'รูปภาพสินค้า')); grid.appendChild(imgWrap);

  var optWrap = document.createElement('div'); optWrap.className = 'sf-full';
  optWrap.appendChild(makeOptionsField('pOptions', []));
  grid.appendChild(optWrap);

  // Auto-fill per-option barcodes when base ID changes
  setTimeout(function() {
    var baseIdInp = el('pId');
    if (baseIdInp) {
      baseIdInp.addEventListener('input', function() {
        autoFillOptionBarcodes('pOptions', baseIdInp.value.trim());
      });
    }
  }, 200);

  openModal('&#x2B; เพิ่มสินค้าใหม่', '', function() {
    var name = el('pName').value.trim(), id = el('pId').value.trim();
    if (!name) { toast('กรุณากรอกชื่อสินค้า', 'error'); return; }
    if (!id)   { toast('กรุณากรอก ID สินค้า', 'error'); return; }
    stopBarcodeScanner();
    var saveBtn = el('modalSave'); saveBtn.disabled = true; saveBtn.textContent = 'กำลังบันทึก...';
    resolveImage('pImage', function(imgUrl) {
      var optNames = el('pOptions') ? el('pOptions').value.trim() : '';
      var optBcRaw = el('pOptions_barcodes') ? el('pOptions_barcodes').value.trim() : '';
      // Package as "name:barcode,name:barcode" if barcodes present
      var finalOpts = packageOptionsWithBarcodes(optNames, optBcRaw);
      google.script.run.withSuccessHandler(function(r) {
        saveBtn.disabled = false; saveBtn.textContent = 'เพิ่มสินค้า';
        try {
          var res = JSON.parse(r);
          if (res.status === 'Success') { closeModal(); toast('เพิ่มสินค้าแล้ว!', 'success'); loadProducts(currentProductsSheetId); }
          else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
        } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
      }).adminCreateProduct(currentProductsSheetId, id, name, imgUrl || '', el('pPrice').value, el('pDeposit').value, el('pRemaining').value, el('pYuan').value, finalOpts);
    });
  }, 'เพิ่มสินค้า');
  el('modal').classList.add('open');
}

function openEditProductModal(rowIndex) {
  var prod = currentProductsCache.find(function(p) { return p.rowIndex === rowIndex; });
  if (!prod) return;
 
  el('modalBody').innerHTML = '';
  var grid = document.createElement('div'); grid.className = 'sf-grid'; el('modalBody').appendChild(grid);

  function addField(id, label, type, val, fullWidth) {
    var f = document.createElement('div'); f.className = 'sf-group' + (fullWidth ? ' sf-full' : '');
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    var i = document.createElement('input'); i.id = id; i.type = type || 'text';
    if (val !== undefined && val !== null) i.value = val;
    f.appendChild(l); f.appendChild(i); grid.appendChild(f);
  }

  addField('epName', 'ชื่อสินค้า *', 'text', prod.name, true);
  addField('epPrice', 'ราคาเต็ม (฿)', 'number', prod.price, false);
  addField('epDeposit', 'ราคามัดจำ (฿)', 'number', prod.deposit, false);
  addField('epRemaining', 'สต็อก', 'number', prod.remaining !== null ? prod.remaining : '', false);
  addField('epYuan', 'ราคาหยวน (¥)', 'number', prod.yuan || 0, false);

  grid.appendChild(makeBarcodeIdField('epId', prod.id, true));

  var imgWrap = document.createElement('div'); imgWrap.className = 'sf-group sf-full';
  imgWrap.appendChild(makeImageField('epImage', prod.image || '', 'รูปภาพสินค้า'));
  grid.appendChild(imgWrap);
 
  // ── Options field ──
  var optWrap = document.createElement('div'); optWrap.className = 'sf-full';
  optWrap.appendChild(makeOptionsField('epOptions', prod.options || ''));
  grid.appendChild(optWrap);
 
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
var stockCache = []; // [{rowIndex, level, id, name, image, price, deposit, yuan, stock, status, children:[]}]

function renderStockPanel() {
  setTopbar('คลังสินค้า', 'จัดการสต็อกจาก Shop_Util');
  el('topbarActions').innerHTML = '';
  var addBtn9 = makeBtn('btn btn-primary btn-sm', '&#x2B; เพิ่มสินค้า', openCreateStockModal);
  var bulkBtn9 = makeBtn('btn btn-ghost btn-sm', '&#x1F4CB; เพิ่มหลาย', openBulkStockModal);
  var refBtn9 = makeBtn('btn btn-ghost btn-sm', '&#x21BB;', function() { loadStock(renderStockContent); });
  refBtn9.title = 'รีเฟรช';
  el('topbarActions').appendChild(addBtn9);
  el('topbarActions').appendChild(bulkBtn9);
  el('topbarActions').appendChild(refBtn9);
  el('content').innerHTML = ''; el('content').appendChild(makeSpinner());
  loadStock(renderStockContent);
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

var stockSearchQuery = '';
var _stockSelected = {};  // rowIndex → true when card is selected
var _stockQtyMap   = {};  // rowIndex → qty

function renderStockContent() {
  el('content').innerHTML = '';
  var wrap = document.createElement('div');

  // ── Stats row ──
  var statRow = div('stat-row');
  var totalStock = 0;
  stockCache.forEach(function(p) { if (p.stock) totalStock += p.stock; });
  statRow.appendChild(makeStat('สินค้าในคลัง', stockCache.length, ''));
  statRow.appendChild(makeStat('สต็อกรวม', totalStock, 'success'));
  wrap.appendChild(statRow);

  // ── Card grid ──
  _stockSelected = {}; _stockQtyMap = {};
  var cardGrid = document.createElement('div'); cardGrid.id = 'stockCardGrid';
  cardGrid.style.cssText = 'display:grid;gap:12px;';
  wrap.appendChild(cardGrid);

  // ── Sticky import bar — follows the scroll so importing never needs a trip back to the top ──
  var pushBar = document.createElement('div');
  pushBar.className = 'sticky-save-bar stock-command-overlay';

  // Keep product search in the always-visible command overlay so mobile
  // users do not need to scroll back to the top between scans/selections.
  var searchCard = document.createElement('div'); searchCard.className = 'stock-overlay-search';
  var searchInp = document.createElement('input'); searchInp.type = 'search';
  searchInp.className = 'stock-overlay-search-input';
  searchInp.placeholder = '🔍 ค้นหาชื่อหรือบาร์โค้ด...';
  searchInp.setAttribute('aria-label', 'ค้นหาสินค้าในคลัง');
  searchInp.value = stockSearchQuery;
  searchInp.oninput = function() {
    stockSearchQuery = searchInp.value.toLowerCase().trim();
    renderStockCards(cardGrid, stockSearchQuery);
  };
  searchCard.appendChild(searchInp);

  var overlayActions = document.createElement('div'); overlayActions.className = 'stock-overlay-actions';
  var selCount = document.createElement('span');
  selCount.className = 'save-count'; selCount.id = 'stockSelCount';
  selCount.style.cssText = 'flex:0 0 auto;white-space:nowrap;';
  selCount.textContent = 'ยังไม่ได้เลือก';
  var selAllBtn = makeBtn('btn btn-ghost btn-sm', 'เลือกทั้งหมด', function() { setAllStockSelection(true); });
  selAllBtn.id = 'stockSelAllBtn';
  var shopSel = document.createElement('select'); shopSel.id = 'stockPushShop';
  shopSel.style.cssText = 'flex:1;min-width:130px;padding:9px 12px;border:1.5px solid var(--border-strong);border-radius:var(--radius-sm);font-size:0.85rem;font-family:var(--font);';
  shopSel.innerHTML = '<option value="">-- เลือกรายการ --</option>';
  var vl = getVisibleLists();
  for (var i = 0; i < vl.length; i++) {
    var o2 = document.createElement('option'); o2.value = vl[i].sheetId; o2.textContent = vl[i].name;
    if (vl[i].sheetId === selectedSheetId && selectedSheetId !== 'ALL') o2.selected = true;
    shopSel.appendChild(o2);
  }
  var pushBtn = makeBtn('btn btn-primary', '📤 นำสินค้าเข้า', function() { pushSelectedToShop(shopSel.value); });
  pushBtn.id = 'stockPushBtn'; pushBtn.style.cssText = 'white-space:nowrap;padding:10px 16px;font-size:0.85rem;';
  overlayActions.appendChild(selCount);
  overlayActions.appendChild(selAllBtn);
  overlayActions.appendChild(shopSel);
  overlayActions.appendChild(pushBtn);
  pushBar.appendChild(searchCard);
  pushBar.appendChild(overlayActions);
  wrap.appendChild(pushBar);

  el('content').appendChild(wrap);
  renderStockCards(cardGrid, stockSearchQuery);
}

// Select every card visible under the current search filter; clearing drops
// every selection, including cards a search filter is currently hiding
function setAllStockSelection(on) {
  if (!on) _stockSelected = {};
  document.querySelectorAll('#stockCardGrid .stock-sel-card').forEach(function(card) {
    var row = parseInt(card.getAttribute('data-row'), 10);
    if (!isFinite(row)) return;
    if (on) _stockSelected[row] = true;
    card.classList.toggle('selected', on);
  });
  refreshStockPushBar();
}

function refreshStockPushBar() {
  var n = Object.keys(_stockSelected).filter(function(k) { return _stockSelected[k]; }).length;
  var lbl = document.getElementById('stockSelCount');
  if (lbl) {
    lbl.textContent = n ? 'เลือกแล้ว ' + n : 'ยังไม่ได้เลือก';
    lbl.className = 'save-count' + (n ? ' has-changes' : '');
  }
  var btn = document.getElementById('stockSelAllBtn');
  if (btn) {
    var visible = document.querySelectorAll('#stockCardGrid .stock-sel-card').length;
    var allOn = visible > 0 && document.querySelectorAll('#stockCardGrid .stock-sel-card.selected').length === visible;
    btn.textContent = allOn ? 'ล้างที่เลือก' : 'เลือกทั้งหมด';
    btn.onclick = function() { setAllStockSelection(!allOn); };
  }
}

function defaultStockImportQty(product) {
  // The quantity picker maps to products.remaining only for single products.
  // Option products keep their per-option warehouse counts and currently import
  // as an unlimited option group, so their picker stays at 1.
  if (product.children && product.children.length) return 1;
  if (product.stock === null || product.stock === undefined || product.stock === '') return 1;
  var available = Math.floor(Number(product.stock));
  return isFinite(available) ? Math.max(0, available) : 1;
}

// 0 = has stock to allocate (or unlimited), 1 = everything at zero
function stockAvailabilityRank(p) {
  if (p.children && p.children.length) {
    var anyAvail = p.children.some(function(c) {
      return c.stock === null || Number(c.stock) > 0;
    });
    return anyAvail ? 0 : 1;
  }
  if (p.stock === null || p.stock === undefined) return 0;
  return Number(p.stock) > 0 ? 0 : 1;
}

function renderStockCards(container, query) {
  container.innerHTML = '';
  var filtered = stockCache.filter(function(p) {
    if (!query) return true;
    var haystack = (p.name + ' ' + p.id + ' ' + p.children.map(function(c){ return c.name + ' ' + c.id; }).join(' ')).toLowerCase();
    return haystack.indexOf(query) !== -1;
  });
  // Items with stock left come first; zeroed-out items sink to the bottom
  filtered = filtered.slice().sort(function(a, b) {
    return stockAvailabilityRank(a) - stockAvailabilityRank(b);
  });

  if (!filtered.length) {
    var empty = document.createElement('div');
    empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:48px 16px;color:var(--text-3);font-size:0.9rem;';
    empty.innerHTML = query ? '🔍 ไม่พบสินค้าที่ค้นหา' : '📦 ยังไม่มีสินค้าในคลัง';
    container.appendChild(empty); return;
  }

  filtered.forEach(function(p) {
    if (_stockQtyMap[p.rowIndex] === undefined) {
      _stockQtyMap[p.rowIndex] = defaultStockImportQty(p);
    }

    var card = document.createElement('div');
    card.className = 'stock-sel-card';
    card.setAttribute('data-row', p.rowIndex);
    card.style.cssText = [
      'background:var(--surface);border:1.5px solid var(--border);border-radius:14px;',
      'overflow:hidden;display:flex;flex-direction:column;user-select:none;'
    ].join('');
    if (_stockSelected[p.rowIndex]) {
      card.classList.add('selected');
    }

    // Toggle selection on card click (but not on edit/delete buttons)
    card.addEventListener('click', (function(pp) {
      return function(e) {
        if (e.target.closest('button')) return;
        _stockSelected[pp.rowIndex] = !_stockSelected[pp.rowIndex];
        card.classList.toggle('selected', !!_stockSelected[pp.rowIndex]);
        refreshStockPushBar();
      };
    })(p));

    // Image strip or placeholder
    var imgStrip = document.createElement('div');
    imgStrip.style.cssText = 'height:100px;background:var(--surface-2);position:relative;overflow:hidden;flex-shrink:0;';
    if (p.image) {
      var img = document.createElement('img'); img.src = p.image;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
      imgStrip.appendChild(img);
    } else {
      imgStrip.innerHTML = '<div style="height:100%;display:flex;align-items:center;justify-content:center;"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--border-strong)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>';
    }
    // Selection badge (checkmark shown when selected)
    var selBadge = document.createElement('div');
    selBadge.className = 'sel-badge';
    selBadge.textContent = '✓';
    imgStrip.appendChild(selBadge);
    // Status badge overlay
    var statusBadge = document.createElement('div');
    statusBadge.style.cssText = 'position:absolute;top:6px;right:6px;font-size:0.65rem;font-weight:700;padding:2px 6px;border-radius:999px;' + (p.status === 'Open' ? 'background:var(--success-light);color:var(--success);border:1px solid var(--success);' : 'background:var(--surface-2);color:var(--text-3);border:1px solid var(--border);');
    statusBadge.textContent = p.status === 'Open' ? 'เปิด' : 'ปิด';
    imgStrip.appendChild(statusBadge);
    card.appendChild(imgStrip);

    // Card body
    var body9 = document.createElement('div'); body9.style.cssText = 'padding:10px;flex:1;display:flex;flex-direction:column;gap:6px;';

    // Name + option count
    var nameEl = document.createElement('div'); nameEl.style.cssText = 'font-weight:700;font-size:0.85rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameEl.textContent = p.name;
    body9.appendChild(nameEl);
    if (p.children.length) {
      var optBadge9 = document.createElement('span');
      optBadge9.style.cssText = 'font-size:0.65rem;font-weight:700;background:var(--primary-light);color:var(--primary);border-radius:999px;padding:1px 7px;display:inline-block;';
      optBadge9.textContent = p.children.length + ' ตัวเลือก';
      body9.appendChild(optBadge9);
    }

    // Price + stock row
    var metaRow = document.createElement('div'); metaRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
    if (p.price) {
      var priceEl = document.createElement('span'); priceEl.style.cssText = 'font-size:0.8rem;font-weight:600;color:var(--text-2);';
      priceEl.textContent = fmt(p.price); metaRow.appendChild(priceEl);
    }
    // For products with options, sum children's stock; otherwise use own stock
    var displayStock;
    if (p.children.length) {
      var anyUnlimited = p.children.some(function(c) { return c.stock === null; });
      displayStock = anyUnlimited ? null : p.children.reduce(function(s, c) { return s + (Number(c.stock) || 0); }, 0);
    } else {
      displayStock = p.stock;
    }
    var stockBadge9 = document.createElement('span');
    if (displayStock === null) { stockBadge9.className = 'stock-count-badge inf'; stockBadge9.textContent = '∞'; }
    else if (displayStock <= 3) { stockBadge9.className = 'stock-count-badge low'; stockBadge9.textContent = displayStock; }
    else { stockBadge9.className = 'stock-count-badge ok'; stockBadge9.textContent = displayStock; }
    metaRow.appendChild(stockBadge9); body9.appendChild(metaRow);

    // Options list (children) — compact, max 3 visible then scroll
    if (p.children.length) {
      var optList = document.createElement('div'); optList.style.cssText = 'display:flex;flex-direction:column;gap:2px;' + (p.children.length > 3 ? 'max-height:90px;overflow-y:auto;' : '');
      p.children.forEach(function(child) {
        var optRow9 = document.createElement('div'); optRow9.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 5px;background:var(--surface-2);border-radius:6px;';
        var cname9 = document.createElement('span'); cname9.style.cssText = 'font-size:0.72rem;font-weight:600;color:var(--text-2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        cname9.textContent = child.name; optRow9.appendChild(cname9);
        var cstock9 = document.createElement('span');
        if (child.stock === null) { cstock9.className = 'stock-count-badge inf'; cstock9.textContent = '∞'; }
        else { cstock9.className = 'stock-count-badge' + (child.stock <= 3 ? ' low' : ' ok'); cstock9.textContent = child.stock; }
        cstock9.style.cssText += 'padding:1px 5px;font-size:0.65rem;';
        optRow9.appendChild(cstock9);
        var cEditBtn9 = document.createElement('button'); cEditBtn9.type = 'button';
        cEditBtn9.innerHTML = SVG_EDIT; cEditBtn9.style.cssText = 'width:34px;height:34px;border:1px solid var(--border);border-radius:8px;background:var(--surface);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        cEditBtn9.onclick = (function(c9, par9) { return function(e) { e.stopPropagation(); openEditStockChildModal(c9, par9); }; })(child, p);
        optRow9.appendChild(cEditBtn9); optList.appendChild(optRow9);
      });
      body9.appendChild(optList);
    }

    // Footer: stepper + action buttons
    var footRow = document.createElement('div'); footRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:auto;padding-top:8px;border-top:1px solid var(--border);';

    // +/- stepper with a typeable amount (clamped to warehouse stock)
    var stepper = document.createElement('div'); stepper.className = 'qty-stepper';
    var maxQtyOf = function(pp) {
      var finiteMax = (pp.children && pp.children.length) ? null : pp.stock;
      return finiteMax !== null && finiteMax !== undefined ? Math.max(0, Math.floor(Number(finiteMax) || 0)) : 999;
    };
    var minusBtn = document.createElement('button'); minusBtn.type = 'button'; minusBtn.className = 'qty-stepper-btn'; minusBtn.textContent = '−';
    minusBtn.setAttribute('aria-label', 'ลดจำนวนนำเข้า');
    var qtyInp = document.createElement('input');
    qtyInp.type = 'number'; qtyInp.min = '1'; qtyInp.className = 'qty-stepper-input';
    qtyInp.id = 'stockqty_' + p.rowIndex;
    qtyInp.value = _stockQtyMap[p.rowIndex];
    qtyInp.setAttribute('aria-label', 'จำนวนนำเข้า ' + p.name);
    qtyInp.onclick = function(e) { e.stopPropagation(); };
    var plusBtn  = document.createElement('button'); plusBtn.type = 'button'; plusBtn.className = 'qty-stepper-btn'; plusBtn.textContent = '+';
    plusBtn.setAttribute('aria-label', 'เพิ่มจำนวนนำเข้า');
    var syncQty = (function(pp, inp) { return function(v) {
      v = Math.floor(Number(v));
      if (!isFinite(v) || v < 1) v = 1;
      var maxV = maxQtyOf(pp);
      if (maxV > 0 && v > maxV) v = maxV;
      _stockQtyMap[pp.rowIndex] = v;
      inp.value = v;
    }; })(p, qtyInp);
    minusBtn.onclick = (function(pp, inp) { return function(e) {
      e.stopPropagation(); syncQty(_stockQtyMap[pp.rowIndex] - 1);
    }; })(p, qtyInp);
    plusBtn.onclick = (function(pp, inp) { return function(e) {
      e.stopPropagation(); syncQty(_stockQtyMap[pp.rowIndex] + 1);
    }; })(p, qtyInp);
    qtyInp.onchange = function() { syncQty(this.value); };
    stepper.appendChild(minusBtn); stepper.appendChild(qtyInp); stepper.appendChild(plusBtn);
    footRow.appendChild(stepper);

    var spacer = document.createElement('div'); spacer.style.cssText = 'flex:1;';
    footRow.appendChild(spacer);

    var editBtn9 = makeBtn('btn-icon', SVG_EDIT); editBtn9.title = 'แก้ไข'; editBtn9.style.cssText = 'width:30px;height:30px;';
    editBtn9.onclick = (function(pp) { return function(e) { e.stopPropagation(); openEditStockModal(pp); }; })(p);
    var delBtn9 = makeBtn('btn-icon', SVG_TRASH); delBtn9.title = 'ลบ'; delBtn9.style.cssText = 'color:var(--error);border-color:var(--error);width:30px;height:30px;';
    delBtn9.onclick = (function(pp) { return function(e) { e.stopPropagation(); confirmDeleteStockProduct(pp); }; })(p);
    footRow.appendChild(editBtn9); footRow.appendChild(delBtn9);
    body9.appendChild(footRow); card.appendChild(body9);
    container.appendChild(card);
  });
  refreshStockPushBar();
}

function pushSelectedToShop(targetSheetId) {
  if (!targetSheetId) { toast('กรุณาเลือกรายการสั่งซื้อ', 'error'); return; }
  var selectedKeys = Object.keys(_stockSelected).filter(function(k) { return _stockSelected[k]; });
  if (!selectedKeys.length) { toast('กรุณาเลือกสินค้าอย่างน้อย 1 รายการ', 'error'); return; }
  var items = [];
  for (var i = 0; i < selectedKeys.length; i++) {
    var parentRowIdx = parseInt(selectedKeys[i], 10);
    var parentProd   = stockCache.find(function(p) { return p.rowIndex === parentRowIdx; });
    var qty2         = _stockQtyMap[parentRowIdx] || 1;
    if (qty2 < 1) { toast('จำนวนต้องมากกว่า 0', 'error'); return; }
    var childRows = parentProd ? parentProd.children.map(function(c) { return c.rowIndex; }) : [];
    items.push({ parentRowIndex: parentRowIdx, childRowIndexes: childRows, qty: qty2 });
  }
  var btn = el('stockPushBtn'); if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า...'; }
  google.script.run.withSuccessHandler(function(r) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F4E4; นำสินค้าเข้า'; }
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        var msg = 'นำสินค้าเข้าแล้ว ' + res.pushed + ' รายการ';
        if (res.deducted) msg += ' • ตัดสต็อกคลังแล้ว';
        toast(msg, 'success');
        loadStock(renderStockContent);
      }
      else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
    } catch(e) { toast('เกิดข้อผิดพลาด', 'error'); }
  }).withFailureHandler(function(error) {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#x1F4E4; นำสินค้าเข้า'; }
    toast(error && error.message ? error.message : 'นำสินค้าเข้าไม่สำเร็จ', 'error');
  }).adminPushStockToShop(targetSheetId, items);
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

  if (item.isOption && parent && child) {
    toast('พบบาร์โค้ดแล้ว — เปิดแก้ไขสต็อกตัวเลือก', 'success');
    openEditStockChildModal(child, parent);
    return;
  }
  if (!item.isOption && parent) {
    toast('พบบาร์โค้ดแล้ว — เปิดแก้ไขสินค้า', 'success');
    openEditStockModal(parent);
    return;
  }
  if (!refreshed) {
    loadStock(function() { openMatchedStockEditor(item, true); });
    return;
  }
  toast('พบสินค้า แต่เปิดหน้าแก้ไขไม่สำเร็จ — กรุณารีเฟรชคลัง', 'error');
}

// ── Create Stock Product — barcode-first duplicate check ──
function openCreateStockModal() {
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
        openCreateStockForm(barcode);
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
function openCreateStockForm(prefillBarcode) {
  el('modalBody').innerHTML = '';
  var isOptionsMode = false; // toggle state
  var draft = {
    name: '', price: '', deposit: '', yuan: '', image: '',
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

    // Price row
    sfField('spPrice',   'ราคาเต็ม (฿)',  'number', '0', false, draft.price);
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

    var saveBtn3 = el('modalSave'); saveBtn3.disabled = true; saveBtn3.textContent = 'กำลังบันทึก...';
    resolveImage('spImage', function(imgUrl) {
      product.image = imgUrl || '';
      resolveAllOptionImages(options, function(resolvedOpts) {
        google.script.run.withSuccessHandler(function(r) {
          saveBtn3.disabled = false; saveBtn3.textContent = 'เพิ่มสินค้า';
          try {
            var res = JSON.parse(r);
            if (res.status === 'Success') { closeModal(); toast('เพิ่มสินค้าในคลังแล้ว!', 'success'); loadStock(renderStockContent); }
            else { toast(res.message || 'เกิดข้อผิดพลาด', 'error'); }
          } catch(e) {
            saveBtn3.disabled = false; saveBtn3.textContent = 'เพิ่มสินค้า';
            toast('เกิดข้อผิดพลาด', 'error');
          }
        }).adminCreateStockProduct(product, resolvedOpts);
      });
    });
  }, 'เพิ่มสินค้า');
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
  var bulkSRows = [makeBulkSRow()];

  function makeBulkSRow(d) {
    return {
      name: (d&&d.name)||'', price: (d&&d.price)||'',
      deposit: (d&&d.deposit)||'', yuan: (d&&d.yuan)||'',
      stock: (d&&d.stock)||'', id: (d&&d.id)||generateRandomBarcode(),
      image: (d&&d.image)||'',
      mode: (d&&d.mode)||'single',
      opts: (d&&d.opts)||[],
      status: 'pending'
    };
  }
  function makeBulkSOpt() { return { name:'', id: generateRandomBarcode(), image:'', stock:'' }; }

  function buildBulkSUI() {
    el('modalBody').innerHTML = '';
    var intro = document.createElement('div');
    intro.style.cssText = 'font-size:0.8rem;color:var(--text-3);margin-bottom:12px;line-height:1.5;';
    intro.innerHTML = '📋 เพิ่มสินค้าหลายรายการเข้าคลังพร้อมกัน';
    el('modalBody').appendChild(intro);
    var bulkSList = document.createElement('div');
    bulkSList.id = 'bulkSList';
    bulkSList.style.cssText = 'display:flex;flex-direction:column;gap:10px;margin-bottom:10px;';
    el('modalBody').appendChild(bulkSList);
    renderBulkSRows(bulkSList);
    var addRowBtn2 = document.createElement('button'); addRowBtn2.type = 'button'; addRowBtn2.className = 'add-opt-btn';
    addRowBtn2.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> เพิ่มสินค้า';
    addRowBtn2.style.marginBottom = '6px';
    addRowBtn2.onclick = function() { bulkSRows.push(makeBulkSRow()); var sl = document.getElementById('bulkSList'); if (sl) renderBulkSRows(sl); };
    el('modalBody').appendChild(addRowBtn2);
  }

  function renderBulkSRows(container) {
    container.innerHTML = '';
    bulkSRows.forEach(function(row, idx) {
      var card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1.5px solid var(--border);border-radius:14px;overflow:hidden;transition:border-color 0.15s;';
      if (row.status === 'done')  card.style.borderColor = 'var(--success)';
      if (row.status === 'error') card.style.borderColor = 'var(--error)';

      // Header
      var chdr = document.createElement('div');
      chdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);';
      var leftHdr = document.createElement('div'); leftHdr.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var cnum = document.createElement('span');
      cnum.style.cssText = 'font-size:0.72rem;font-weight:800;color:var(--primary);text-transform:uppercase;';
      cnum.textContent = 'สินค้า #' + (idx + 1);
      if (row.status === 'saving') cnum.innerHTML += ' <span class="spinner" style="width:12px;height:12px;border-width:2px;display:inline-block;vertical-align:middle;margin-left:4px;"></span>';
      else if (row.status === 'done')  cnum.innerHTML += ' <span style="color:var(--success);margin-left:4px;">✓</span>';
      else if (row.status === 'error') cnum.innerHTML += ' <span style="color:var(--error);margin-left:4px;">✗</span>';
      leftHdr.appendChild(cnum);

      // Mode toggle
      var tog = document.createElement('div');
      tog.style.cssText = 'display:inline-flex;background:var(--bg);border:1px solid var(--border);border-radius:999px;padding:2px;gap:1px;';
      function mkSTog(label, mode) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.style.cssText = 'border:none;border-radius:999px;padding:3px 10px;font-size:0.7rem;font-weight:700;font-family:var(--font);cursor:pointer;transition:all 0.15s;' +
          (row.mode === mode ? 'background:var(--primary);color:#fff;' : 'background:transparent;color:var(--text-3);');
        b.onclick = function() { row.mode = mode; if (mode === 'options' && !row.opts.length) row.opts.push(makeBulkSOpt()); var sl = document.getElementById('bulkSList'); if (sl) renderBulkSRows(sl); };
        return b;
      }
      tog.appendChild(mkSTog('🏷 เดียว', 'single'));
      tog.appendChild(mkSTog('🎨 ตัวเลือก', 'options'));
      leftHdr.appendChild(tog);

      var cdelBtn = document.createElement('button'); cdelBtn.type = 'button'; cdelBtn.innerHTML = '×';
      cdelBtn.style.cssText = 'background:none;border:none;color:var(--text-3);font-size:1.2rem;cursor:pointer;padding:0 2px;line-height:1;';
      cdelBtn.onclick = function() { if (bulkSRows.length > 1) { bulkSRows.splice(idx, 1); var sl = document.getElementById('bulkSList'); if (sl) renderBulkSRows(sl); } };
      chdr.appendChild(leftHdr); chdr.appendChild(cdelBtn); card.appendChild(chdr);

      // Body
      var body = document.createElement('div'); body.style.cssText = 'padding:12px 14px;';

      // Image + name top row
      var topRow = document.createElement('div'); topRow.style.cssText = 'display:flex;gap:12px;align-items:flex-start;margin-bottom:12px;';
      var sImgPKey = 'sbulk_img_' + idx;
      var sImgB = makeBulkImgBox(sImgPKey, row.image && !row.image.startsWith('__pending__') ? row.image : '', function(v) { row.image = v; });
      sImgB.el.title = 'แตะเพื่อเลือกรูปหรือถ่ายรูป';
      topRow.appendChild(sImgB.el);
      var sNameGrp = document.createElement('div'); sNameGrp.style.cssText = 'flex:1;min-width:0;';
      var sNLbl = document.createElement('label'); sNLbl.textContent = 'ชื่อสินค้า *';
      sNLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
      var sNInp = document.createElement('input'); sNInp.type = 'text';
      sNInp.value = row.name || ''; sNInp.placeholder = 'เช่น Acrylic Stand A';
      sNInp.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:0.88rem;font-family:var(--font);background:var(--surface-2);outline:none;';
      sNInp.onfocus = function() { sNInp.style.borderColor='var(--primary)'; }; sNInp.onblur = function() { sNInp.style.borderColor='var(--border)'; };
      sNInp.oninput = function() { row.name = sNInp.value; };
      sNameGrp.appendChild(sNLbl); sNameGrp.appendChild(sNInp); topRow.appendChild(sNameGrp);
      body.appendChild(topRow);

      // Price grid
      var pg = document.createElement('div'); pg.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;';
      function mkSPI(key, label, ph, isNum) {
        var g = document.createElement('div');
        var l = document.createElement('label'); l.textContent = label;
        l.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
        var i = document.createElement('input'); i.type = isNum ? 'number' : 'text';
        i.value = row[key]||''; i.placeholder = ph||'';
        i.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.82rem;font-family:var(--font);background:var(--surface-2);outline:none;';
        i.onfocus = function() { i.style.borderColor='var(--primary)'; }; i.onblur = function() { i.style.borderColor='var(--border)'; };
        i.oninput = function() { row[key] = i.value; };
        g.appendChild(l); g.appendChild(i); pg.appendChild(g);
      }
      mkSPI('price','ราคาเต็ม (฿)','0',true);
      mkSPI('deposit','ราคามัดจำ (฿)','0',true);
      mkSPI('yuan','ราคาหยวน (¥)','0',true);
      if (row.mode === 'single') mkSPI('stock','สต็อก','ว่าง=∞',true);
      body.appendChild(pg);

      // ID (single mode only)
      if (row.mode === 'single') {
        var sIdGrp = document.createElement('div'); sIdGrp.style.marginBottom = '10px';
        var sIdLbl = document.createElement('label'); sIdLbl.textContent = 'ID / บาร์โค้ด *';
        sIdLbl.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
        var sIdRowDiv = document.createElement('div'); sIdRowDiv.style.cssText = 'display:flex;gap:6px;align-items:center;';
        var sIdInp = document.createElement('input'); sIdInp.type = 'text';
        sIdInp.value = row.id||''; sIdInp.placeholder = 'สแกนหรือพิมพ์บาร์โค้ด';
        sIdInp.style.cssText = 'flex:1;border:1.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:0.85rem;font-family:monospace;background:var(--surface-2);outline:none;min-width:0;';
        sIdInp.onfocus = function() { sIdInp.style.borderColor='var(--primary)'; }; sIdInp.onblur = function() { sIdInp.style.borderColor='var(--border)'; };
        sIdInp.oninput = function() { row.id = sIdInp.value; };
        var sScanBtn = document.createElement('button'); sScanBtn.type='button'; sScanBtn.innerHTML='📷';
        sScanBtn.style.cssText = 'padding:7px 10px;border:1.5px solid var(--primary);border-radius:8px;background:var(--primary-light);color:var(--primary);font-size:0.8rem;cursor:pointer;flex-shrink:0;';
        sScanBtn.onclick = (function(inp,btn){ return function(){
          var tok='sbk_bc_'+Date.now(); var pop=window.open('','sbk_bc_'+idx,'width=420,height=600,resizable=yes');
          if(!pop){toast('กรุณาอนุญาต Pop-up','error');return;}
          btn.innerHTML='⏹';btn.disabled=true;
          function srst(){btn.innerHTML='📷';btn.disabled=false;}
          window.__barcodeResultBridge=function(t,bc){if(t!==tok)return;inp.value=bc;row.id=bc;delete window.__barcodeResultBridge;srst();try{if(pop&&!pop.closed)pop.close();}catch(e){}};
          pop.document.open();pop.document.write(makeScannerPopupHtml(tok));pop.document.close();
          var ck=setInterval(function(){try{if(pop&&!pop.closed&&pop.__barcodeResult){var rv=pop.__barcodeResult;clearInterval(ck);delete window.__barcodeResultBridge;inp.value=rv;row.id=rv;srst();pop.close();return;}if(!pop||pop.closed){clearInterval(ck);delete window.__barcodeResultBridge;srst();}}catch(e2){clearInterval(ck);srst();}},250);
        };})(sIdInp,sScanBtn);
        var sRandBtn = document.createElement('button'); sRandBtn.type='button'; sRandBtn.innerHTML='🎲';
        sRandBtn.style.cssText = 'padding:7px 10px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface-2);color:var(--text-2);font-size:0.8rem;cursor:pointer;flex-shrink:0;';
        sRandBtn.onclick = function() { row.id=generateRandomBarcode(); sIdInp.value=row.id; };
        sIdRowDiv.appendChild(sIdInp);sIdRowDiv.appendChild(sScanBtn);sIdRowDiv.appendChild(sRandBtn);
        sIdGrp.appendChild(sIdLbl);sIdGrp.appendChild(sIdRowDiv);body.appendChild(sIdGrp);
      }

      // Options section
      if (row.mode === 'options') {
        var optSep = document.createElement('hr'); optSep.style.cssText = 'border:none;border-top:1px solid var(--border);margin:6px 0 10px;';
        body.appendChild(optSep);
        var optHdr = document.createElement('div'); optHdr.style.cssText = 'font-size:0.72rem;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;';
        optHdr.textContent = 'ตัวเลือกสินค้า';
        body.appendChild(optHdr);
        var optList = document.createElement('div'); optList.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

        row.opts.forEach(function(opt, oi) {
          var oc = document.createElement('div');
          oc.className = 'opt-card'; oc.style.cssText = 'padding:10px 12px;';
          var ohdr = document.createElement('div'); ohdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
          var olbl = document.createElement('span'); olbl.className = 'opt-card-label opt-badge';
          olbl.textContent = 'ตัวเลือก ' + (oi+1<10?'0'+(oi+1):oi+1);
          var odel = document.createElement('button'); odel.type='button'; odel.innerHTML='×';
          odel.className = 'opt-card-del';
          odel.onclick = (function(r2,oi2){return function(){r2.opts.splice(oi2,1);var sl=document.getElementById('bulkSList');if(sl)renderBulkSRows(sl);};})(row,oi);
          ohdr.appendChild(olbl);ohdr.appendChild(odel);oc.appendChild(ohdr);

          var oTop = document.createElement('div'); oTop.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;';
          var oImgKey = 'sbulk_opt_img_'+idx+'_'+oi;
          var oIB = makeBulkImgBox(oImgKey, opt.image&&!opt.image.startsWith('__pending__')?opt.image:'', function(v){opt.image=v;});
          oIB.el.style.width='52px'; oIB.el.style.height='52px';
          oTop.appendChild(oIB.el);
          var oNG = document.createElement('div'); oNG.style.cssText='flex:1;min-width:0;';
          var oNL = document.createElement('label'); oNL.textContent='ชื่อตัวเลือก';
          oNL.style.cssText='display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oNI = document.createElement('input'); oNI.type='text'; oNI.value=opt.name||''; oNI.placeholder='เช่น สีแดง, Size M';
          oNI.style.cssText='width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.85rem;font-family:var(--font);background:var(--surface);outline:none;';
          oNI.onfocus=function(){oNI.style.borderColor='var(--primary)';}; oNI.onblur=function(){oNI.style.borderColor='var(--border)';};
          oNI.oninput=function(){opt.name=oNI.value;};
          oNG.appendChild(oNL);oNG.appendChild(oNI);oTop.appendChild(oNG);oc.appendChild(oTop);

          var oBcG = document.createElement('div');
          var oBcL = document.createElement('label'); oBcL.textContent='บาร์โค้ด';
          oBcL.style.cssText='display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oBcR = document.createElement('div'); oBcR.style.cssText='display:flex;gap:6px;';
          var oBcI = document.createElement('input'); oBcI.type='text'; oBcI.value=opt.id||''; oBcI.placeholder='บาร์โค้ดตัวเลือกนี้';
          oBcI.style.cssText='flex:1;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.82rem;font-family:monospace;background:var(--surface);outline:none;min-width:0;';
          oBcI.onfocus=function(){oBcI.style.borderColor='var(--primary)';}; oBcI.onblur=function(){oBcI.style.borderColor='var(--border)';};
          oBcI.oninput=function(){opt.id=oBcI.value;};
          var oBcScan = document.createElement('button'); oBcScan.type='button'; oBcScan.innerHTML='📷';
          oBcScan.style.cssText='padding:6px 9px;border:1.5px solid var(--primary);border-radius:8px;background:var(--primary-light);color:var(--primary);font-size:0.78rem;cursor:pointer;flex-shrink:0;';
          oBcScan.onclick=(function(inp,btn){return function(){
            var tok='sbkopt_'+Date.now(); var pop=window.open('','sbkopt_'+idx+'_'+oi,'width=420,height=600,resizable=yes');
            if(!pop){toast('กรุณาอนุญาต Pop-up','error');return;}
            btn.innerHTML='⏹';btn.disabled=true;
            function rst2(){btn.innerHTML='📷';btn.disabled=false;}
            window.__barcodeResultBridge=function(t,bc){if(t!==tok)return;inp.value=bc;opt.id=bc;delete window.__barcodeResultBridge;rst2();try{if(pop&&!pop.closed)pop.close();}catch(e){}};
            pop.document.open();pop.document.write(makeScannerPopupHtml(tok));pop.document.close();
            var ck2=setInterval(function(){try{if(pop&&!pop.closed&&pop.__barcodeResult){var rv=pop.__barcodeResult;clearInterval(ck2);delete window.__barcodeResultBridge;inp.value=rv;opt.id=rv;rst2();pop.close();return;}if(!pop||pop.closed){clearInterval(ck2);delete window.__barcodeResultBridge;rst2();}}catch(e2){clearInterval(ck2);rst2();}},250);
          };})(oBcI,oBcScan);
          var oBcRnd = document.createElement('button'); oBcRnd.type='button'; oBcRnd.innerHTML='🎲';
          oBcRnd.style.cssText='padding:6px 9px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text-2);font-size:0.78rem;cursor:pointer;flex-shrink:0;';
          oBcRnd.onclick=function(){opt.id=nextBarcodeFromPrevious(row.opts[oi>0?oi-1:0].id||'');oBcI.value=opt.id;};
          oBcR.appendChild(oBcI);oBcR.appendChild(oBcScan);oBcR.appendChild(oBcRnd);
          oBcG.appendChild(oBcL);oBcG.appendChild(oBcR);oc.appendChild(oBcG);

          // Stock input per option
          var oSG = document.createElement('div'); oSG.style.marginTop = '8px';
          var oSL = document.createElement('label'); oSL.textContent = 'สต็อก (ว่าง = ไม่จำกัด)';
          oSL.style.cssText = 'display:block;font-size:0.68rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:3px;';
          var oSI = document.createElement('input'); oSI.type = 'number'; oSI.min = '0';
          oSI.value = opt.stock !== undefined && opt.stock !== '' ? opt.stock : '';
          oSI.placeholder = 'ว่าง = ไม่จำกัด';
          oSI.style.cssText = 'width:100%;border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:0.85rem;font-family:var(--font);background:var(--surface);outline:none;';
          oSI.onfocus = function(){oSI.style.borderColor='var(--primary)';}; oSI.onblur = function(){oSI.style.borderColor='var(--border)';};
          oSI.oninput = function(){opt.stock = oSI.value;};
          oSG.appendChild(oSL); oSG.appendChild(oSI); oc.appendChild(oSG);

          optList.appendChild(oc);
        });
        body.appendChild(optList);

        var addOptBtn2 = document.createElement('button'); addOptBtn2.type='button';
        addOptBtn2.style.cssText='width:100%;margin-top:8px;padding:8px;border:1.5px dashed var(--border-strong);border-radius:10px;background:transparent;color:var(--text-3);font-size:0.8rem;font-weight:700;font-family:var(--font);cursor:pointer;';
        addOptBtn2.innerHTML='+ เพิ่มตัวเลือก';
        addOptBtn2.onmouseenter=function(){addOptBtn2.style.borderColor='var(--primary)';addOptBtn2.style.color='var(--primary)';};
        addOptBtn2.onmouseleave=function(){addOptBtn2.style.borderColor='var(--border-strong)';addOptBtn2.style.color='var(--text-3)';};
        addOptBtn2.onclick=(function(r2){return function(){r2.opts.push(makeBulkSOpt());var sl=document.getElementById('bulkSList');if(sl)renderBulkSRows(sl);};})(row);
        body.appendChild(addOptBtn2);
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
    });
    if (!valid) return;
    var sb2 = el('modalSave'); sb2.disabled=true; sb2.textContent='กำลังบันทึก...';
    var pending2 = bulkSRows.length; var savedCount2 = 0;

    bulkSRows.forEach(function(row, sIdx) {
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
        var oUp = row.opts.filter(function(o,oi){ return pendingImg['sbulk_opt_img_'+sIdx+'_'+oi]; });
        if (!oUp.length) { doSaveStockRow(mainImgUrl, row.opts); return; }
        var op = oUp.length;
        oUp.forEach(function(o) {
          var oi = row.opts.indexOf(o);
          var oKey = 'sbulk_opt_img_'+sIdx+'_'+oi;
          google.script.run
            .withSuccessHandler(function(r){delete pendingImg[oKey];var url='';try{var res=JSON.parse(r);if(res.status==='Success')url=res.url;}catch(ex){}o.image=url;op--;if(op===0)doSaveStockRow(mainImgUrl,row.opts);})
            .withFailureHandler(function(){delete pendingImg[oKey];op--;if(op===0)doSaveStockRow(mainImgUrl,row.opts);})
            .adminUploadImage(pendingImg[oKey]);
        });
      }

      var sPKey = 'sbulk_img_' + sIdx;
      if (pendingImg[sPKey]) {
        var sb64 = pendingImg[sPKey];
        google.script.run
          .withSuccessHandler(function(r){delete pendingImg[sPKey];var url='';try{var res=JSON.parse(r);if(res.status==='Success')url=res.url;}catch(ex){}resolveSOpts(url);})
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
  el('modalBody').innerHTML = '';

  // Image preview banner at top
  if (prod.image) {
    var previewBanner = document.createElement('div');
    previewBanner.style.cssText = 'width:100%;height:140px;background:var(--surface-2);border-radius:10px;overflow:hidden;margin-bottom:14px;';
    var prevImg = document.createElement('img'); prevImg.src = prod.image;
    prevImg.style.cssText = 'width:100%;height:100%;object-fit:contain;';
    previewBanner.appendChild(prevImg);
    el('modalBody').appendChild(previewBanner);
  }

  var grid = document.createElement('div'); grid.className = 'sf-grid'; el('modalBody').appendChild(grid);

  function addFE(id, label, type, val, fullWidth) {
    var f = document.createElement('div');
    f.className = 'sf-group' + (fullWidth ? ' sf-full' : '');
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    var i2 = document.createElement('input'); i2.id = id; i2.type = type || 'text';
    if (val !== undefined && val !== null) i2.value = val;
    f.appendChild(l); f.appendChild(i2); grid.appendChild(f);
  }

  addFE('sepName', 'ชื่อสินค้า *', 'text', prod.name, true);
  grid.appendChild(makeStockBarcodeRow('sepId', prod.id, true));
  addFE('sepPrice',   'ราคาเต็ม (฿)',  'number', prod.price, false);
  addFE('sepDeposit', 'ราคามัดจำ (฿)', 'number', prod.deposit, false);
  addFE('sepYuan',    'ราคาหยวน (¥)',  'number', prod.yuan || 0, false);
  addFE('sepStock',   'สต็อก', 'number', prod.stock !== null ? prod.stock : '', false);
  var imgWrap2 = document.createElement('div'); imgWrap2.className = 'sf-group sf-full';
  imgWrap2.appendChild(makeImageField('sepImage', prod.image || '', 'รูปภาพสินค้า'));
  grid.appendChild(imgWrap2);

  // ── Options section for parent product ──
  if (prod.children && prod.children.length > 0) {
    // Show existing children as editable option cards
    var sepHr = document.createElement('hr'); sepHr.className = 'sf-section-divider sf-full'; grid.appendChild(sepHr);
    var sepOptHdr = document.createElement('div'); sepOptHdr.className = 'sf-full';
    sepOptHdr.style.cssText = 'font-size:0.78rem;font-weight:800;color:var(--text-2);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;';
    sepOptHdr.textContent = 'ตัวเลือกสินค้า (' + prod.children.length + ' รายการ) — แก้ไขได้ด้านล่าง';
    grid.appendChild(sepOptHdr);
    prod.children.forEach(function(child) {
      var childDiv = document.createElement('div'); childDiv.className = 'sf-full';
      childDiv.style.cssText = 'border:1.5px solid var(--primary-light);border-left:3px solid var(--primary);border-radius:10px;padding:10px 12px;background:var(--surface-2);display:flex;align-items:center;gap:10px;';
      if (child.image) { var ci = document.createElement('img'); ci.src = child.image; ci.style.cssText='width:32px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0;'; childDiv.appendChild(ci); }
      var cInfo = document.createElement('div'); cInfo.style.cssText = 'flex:1;min-width:0;';
      cInfo.innerHTML = '<div style="font-weight:700;font-size:0.85rem;">' + escapeHtml(child.name) + '</div><div style="font-family:monospace;font-size:0.72rem;color:var(--primary);">' + escapeHtml(child.id||'—') + '</div>';
      childDiv.appendChild(cInfo);
      var cEditBtn8 = makeBtn('btn-icon', SVG_EDIT); cEditBtn8.style.cssText='width:28px;height:28px;flex-shrink:0;';
      cEditBtn8.onclick = (function(c8,p8) { return function() { closeModal(); setTimeout(function(){ openEditStockChildModal(c8,p8); }, 100); }; })(child, prod);
      childDiv.appendChild(cEditBtn8); grid.appendChild(childDiv);
    });
  }

  // ── Inline new option entry ──
  var newOptSection = document.createElement('div'); newOptSection.className = 'sf-full';
  newOptSection.id = 'sepNewOptSection';
  newOptSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  grid.appendChild(newOptSection);

  var addChildBtn = document.createElement('div'); addChildBtn.className = 'sf-full';
  var addChildBtnEl = document.createElement('button'); addChildBtnEl.type = 'button'; addChildBtnEl.className = 'add-opt-btn';
  addChildBtnEl.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> เพิ่มตัวเลือกใหม่';
  addChildBtnEl.onclick = function() {
    addNewOptionRow('sepNewOptSection', newOptSection.querySelectorAll('.opt-card').length, '');
    var cnt2 = document.getElementById('sepNewOptCount');
    if (cnt2) cnt2.textContent = newOptSection.querySelectorAll('.opt-card').length + ' ใหม่';
  };
  addChildBtn.appendChild(addChildBtnEl); grid.appendChild(addChildBtn);

  appendLinkedProductSyncOption(grid, 'sepSyncLinked', prod.linkedListCount);

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
  var grid = document.createElement('div'); grid.className = 'sf-grid'; el('modalBody').appendChild(grid);

  var parentInfo = document.createElement('div'); parentInfo.className = 'sf-full';
  parentInfo.style.cssText = 'background:var(--primary-light);border:1.5px solid var(--primary);border-radius:10px;padding:10px 14px;font-size:0.82rem;color:var(--primary);font-weight:700;';
  parentInfo.textContent = '📦 สินค้าหลัก: ' + parent.name;
  grid.appendChild(parentInfo);

  function addFA(id, label, type, val, full) {
    var f = document.createElement('div'); f.className = 'sf-group' + (full ? ' sf-full' : '');
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    var i2 = document.createElement('input'); i2.id = id; i2.type = type || 'text';
    if (val !== undefined && val !== null) i2.value = val;
    f.appendChild(l); f.appendChild(i2); grid.appendChild(f);
  }

  addFA('scaName', 'ชื่อตัวเลือก *', 'text', '', true);
  grid.appendChild(makeStockBarcodeRow('scaId', '', true));
  addFA('scaStock', 'สต็อก', 'number', '', true);

  // Image
  var imgWrapA = document.createElement('div'); imgWrapA.className = 'sf-group sf-full';
  imgWrapA.appendChild(makeImageField('scaImage', '', 'รูปภาพตัวเลือก'));
  grid.appendChild(imgWrapA);

  appendLinkedProductSyncOption(grid, 'scaSyncLinked', parent.linkedListCount);

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
  var grid = document.createElement('div'); grid.className = 'sf-grid'; el('modalBody').appendChild(grid);

  function addFC(id, label, type, val, fullWidth) {
    var f = document.createElement('div');
    f.className = 'sf-group' + (fullWidth ? ' sf-full' : '');
    var l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
    var i2 = document.createElement('input'); i2.id = id; i2.type = type || 'text';
    if (val !== undefined && val !== null) i2.value = val;
    f.appendChild(l); f.appendChild(i2); grid.appendChild(f);
  }

  var parentInfo = div('modal-full');
  parentInfo.style.cssText = 'background:var(--primary-light,#ede9ff);border:1.5px solid var(--primary);border-radius:12px;padding:10px 14px;font-size:0.8rem;color:var(--primary);font-weight:600;';
  parentInfo.textContent = '📦 สินค้าหลัก: ' + parent.name;
  grid.appendChild(parentInfo);

  addFC('scName',  'ชื่อตัวเลือก *', 'text',   child.name,  true);
  grid.appendChild(makeStockBarcodeRow('scId', child.id, true));
  addFC('scStock', 'สต็อก',          'number', child.stock !== null ? child.stock : '', false);

  // Shared image component — same look as every other product form
  var scImgGroup = document.createElement('div'); scImgGroup.className = 'sf-group sf-full';
  scImgGroup.appendChild(makeImageField('scImage', child.image || '', 'รูปภาพตัวเลือก'));
  grid.appendChild(scImgGroup);

  appendLinkedProductSyncOption(grid, 'scSyncLinked', parent.linkedListCount);

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

// Compact barcode field for stock modals — uses sf-group + sf-bc-row classes
function makeStockBarcodeRow(fieldId, currentVal, fullWidth) {
  var f = document.createElement('div');
  f.className = 'sf-group' + (fullWidth ? ' sf-full' : '');

  var lbl = document.createElement('label'); lbl.htmlFor = fieldId; lbl.textContent = 'ID / บาร์โค้ด *';
  f.appendChild(lbl);

  var bcRow = document.createElement('div'); bcRow.className = 'sf-bc-row';
  var inp = document.createElement('input'); inp.type = 'text'; inp.id = fieldId;
  inp.value = currentVal || ''; inp.placeholder = 'สแกนหรือพิมพ์บาร์โค้ด';

  // Camera scan
  var camBtn2 = document.createElement('button'); camBtn2.type = 'button';
  camBtn2.className = 'sf-bc-btn cam'; camBtn2.innerHTML = '📷';
  camBtn2.onclick = function() {
    var tok2 = 'sbc_' + fieldId + '_' + Date.now();
    var pop2 = window.open('','sbc_scan_' + fieldId,'width=420,height=600,resizable=yes');
    if (!pop2) { toast('กรุณาอนุญาต Pop-up', 'error'); return; }
    camBtn2.textContent = '⏹'; camBtn2.disabled = true;
    function rs2() { camBtn2.innerHTML = '📷'; camBtn2.disabled = false; }
    window.__barcodeResultBridge = function(t, bc) {
      if (t !== tok2) return; inp.value = bc; delete window.__barcodeResultBridge; rs2();
      try { if (pop2 && !pop2.closed) pop2.close(); } catch(e4) {}
    };
    pop2.document.open(); pop2.document.write(makeScannerPopupHtml(tok2)); pop2.document.close();
    var chk2 = setInterval(function() {
      try {
        if (pop2 && !pop2.closed && pop2.__barcodeResult) { var rr2 = pop2.__barcodeResult; clearInterval(chk2); delete window.__barcodeResultBridge; inp.value = rr2; rs2(); pop2.close(); return; }
        if (!pop2 || pop2.closed) { clearInterval(chk2); delete window.__barcodeResultBridge; rs2(); }
      } catch(e5) { clearInterval(chk2); rs2(); }
    }, 250);
  };

  // Random
  var randBtn6 = document.createElement('button'); randBtn6.type = 'button';
  randBtn6.className = 'sf-bc-btn'; randBtn6.innerHTML = '🎲 สุ่ม';
  randBtn6.onclick = function() {
    inp.value = generateRandomBarcode();
    generateBarcode(inp.value, fieldId);
    var bw = document.getElementById(fieldId + '_barcode'); if (bw) bw.style.display = 'block';
  };

  bcRow.appendChild(inp); bcRow.appendChild(camBtn2); bcRow.appendChild(randBtn6);
  f.appendChild(bcRow);

  // Barcode preview
  var bcPreview = document.createElement('div'); bcPreview.id = fieldId + '_barcode';
  bcPreview.className = 'bc-preview-wrap';
  var cvs6 = document.createElement('canvas'); cvs6.id = fieldId + '_canvas'; bcPreview.appendChild(cvs6);
  f.appendChild(bcPreview);

  if (currentVal) setTimeout(function() { generateBarcode(currentVal, fieldId); var bw = document.getElementById(fieldId + '_barcode'); if (bw) bw.style.display = 'block'; }, 200);
  return f;
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
