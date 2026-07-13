// ══════════════════════════════════
// STATE
// ══════════════════════════════════
var POS_PRODUCTS = [];      // Loaded from parent / Google Apps Script
var POS_CART = [];          // [{product, qty, option, lineTotal}]
var POS_LIST_NAME = '';
var POS_LIST_ID = '';

var _qtyProduct = null;
var _qtyValue = 1;
var _qtyOption = '';

var PLACEHOLDER = 'https://www.svgrepo.com/show/508699/landscape-placeholder.svg';

// ══════════════════════════════════
// ENTRY POINT (called by parent admin page)
// openPOS(products, listName, listId)
// ══════════════════════════════════
function openPOS(products, listName, listId) {
  POS_PRODUCTS = (products || []).filter(function(p){ return p.status === 'Open'; });
  POS_LIST_NAME = listName || 'รายการสั่งซื้อ';
  POS_LIST_ID = listId || '';
  POS_CART = [];

  document.getElementById('posTitle').textContent = '🖥️ POS — ' + POS_LIST_NAME;
  document.getElementById('posSub').textContent = POS_PRODUCTS.length + ' รายการสินค้า';
  document.getElementById('posSearch').value = '';

  renderProducts(POS_PRODUCTS);
  updateCartFab();
  goScreen('pos', null);
  hideLoading();
}

// ══════════════════════════════════
// SCREEN NAVIGATION
// ══════════════════════════════════
var SCREEN_ORDER = ['pos', 'summary', 'payment'];

function goScreen(to, from) {
  SCREEN_ORDER.forEach(function(id) {
    var el = document.getElementById('screen-' + id);
    el.classList.remove('active', 'slide-out');
  });

  if (from) {
    var fromEl = document.getElementById('screen-' + from);
    if (fromEl) fromEl.classList.add('slide-out');
  }

  var toEl = document.getElementById('screen-' + to);
  if (toEl) {
    // Force reflow
    void toEl.offsetWidth;
    toEl.classList.add('active');
  }
}

function goToSummary() {
  if (!POS_CART.length) { posToast('ยังไม่มีสินค้าในตะกร้า', 'error'); return; }
  renderSummary();
  goScreen('summary', 'pos');
}

function goToPayment() {
  if (!POS_CART.length) { posToast('ตะกร้าว่างเปล่า', 'error'); return; }
  renderPayment();
  goScreen('payment', 'summary');
}

function posGoBack() {
  // Called from POS screen back button — close POS mode back to admin
  goScreen('pos', null);
  // Signal parent if embedded
  if (window.parent && window.parent !== window) {
    try { window.parent.closePOSMode && window.parent.closePOSMode(); } catch(e) {}
  }
  if (window.closePOSMode) window.closePOSMode();
}

// ══════════════════════════════════
// PRODUCTS
// ══════════════════════════════════
function renderProducts(prods) {
  var grid = document.getElementById('posProductGrid');
  var empty = document.getElementById('posEmpty');
  grid.innerHTML = '';

  if (!prods || !prods.length) {
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';

  prods.forEach(function(p) {
    var inCart = getCartQty(p.rowIndex);
    var card = document.createElement('div');
    card.className = 'pos-prod-card' + (p.remaining === 0 ? ' out-of-stock' : '');
    card.setAttribute('data-row', p.rowIndex);

    // Image
    if (p.image) {
      var img = document.createElement('img');
      img.className = 'pos-prod-img';
      img.src = p.image;
      img.onerror = function() { this.src = PLACEHOLDER; };
      card.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'pos-prod-img-placeholder';
      ph.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      card.appendChild(ph);
    }

    var body = document.createElement('div');
    body.className = 'pos-prod-body';

    var name = document.createElement('div');
    name.className = 'pos-prod-name';
    name.textContent = p.name;
    body.appendChild(name);

    var price = document.createElement('div');
    price.className = 'pos-prod-price';
    price.textContent = fmt(p.price);
    body.appendChild(price);

    if (p.remaining !== null && p.remaining !== undefined && p.remaining !== '') {
      var stock = document.createElement('div');
      stock.className = 'pos-prod-stock';
      stock.textContent = 'เหลือ ' + p.remaining + ' ชิ้น';
      body.appendChild(stock);
    }

    card.appendChild(body);

    // Cart badge
    if (inCart > 0) {
      var badge = document.createElement('div');
      badge.className = 'pos-prod-badge';
      badge.textContent = inCart;
      card.appendChild(badge);
    }

    // Out-of-stock badge
    if (p.remaining === 0) {
      var oosBadge = document.createElement('div');
      oosBadge.className = 'pos-prod-oos-badge';
      oosBadge.textContent = 'หมด';
      card.appendChild(oosBadge);
    }

    card.onclick = function() { openQtyModal(p); };
    grid.appendChild(card);
  });
}

function filterProducts(term) {
  term = term.trim().toLowerCase();
  var filtered = term
    ? POS_PRODUCTS.filter(function(p) {
        return (p.name || '').toLowerCase().indexOf(term) !== -1 ||
               (p.barcode || p.id || '').toLowerCase().indexOf(term) !== -1;
      })
    : POS_PRODUCTS;
  renderProducts(filtered);
}

function getCartQty(rowIndex) {
  var total = 0;
  POS_CART.forEach(function(item) {
    if (item.product.rowIndex === rowIndex) total += item.qty;
  });
  return total;
}

// ══════════════════════════════════
// QTY MODAL
// ══════════════════════════════════
function openQtyModal(product) {
  _qtyProduct = product;
  _qtyValue = 1;
  _qtyOption = '';

  // Img
  var imgWrap = document.getElementById('qtyModalImg');
  imgWrap.innerHTML = '';
  if (product.image) {
    var img = document.createElement('img');
    img.className = 'qty-modal-img';
    img.src = product.image;
    img.onerror = function() { this.src = PLACEHOLDER; };
    imgWrap.appendChild(img);
  } else {
    var ph = document.createElement('div');
    ph.className = 'qty-modal-img-placeholder';
    ph.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    imgWrap.appendChild(ph);
  }

  document.getElementById('qtyModalName').textContent = product.name;
  document.getElementById('qtyModalPrice').textContent = fmt(product.price) + ' / ชิ้น';
  document.getElementById('qtyNum').textContent = '1';

  // Options
  var opts = parseOptions(product.options);
  var optSec = document.getElementById('qtyOptionsSection');
  var optContainer = document.getElementById('qtyOptions');
  optContainer.innerHTML = '';

  if (opts.length) {
    _qtyOption = opts[0];
    optSec.style.display = 'block';
    opts.forEach(function(opt) {
      var chip = document.createElement('button');
      chip.className = 'qty-opt-chip' + (opt === _qtyOption ? ' selected' : '');
      chip.textContent = opt;
      chip.onclick = function() {
        _qtyOption = opt;
        optContainer.querySelectorAll('.qty-opt-chip').forEach(function(c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
      };
      optContainer.appendChild(chip);
    });
  } else {
    optSec.style.display = 'none';
  }

  document.getElementById('qty-modal').classList.add('open');
}

/**
 * Parse options from "Name:barcode,Name:barcode" or plain "Name,Name" format.
 * Returns array of display names only (stripping barcode part).
 */
function parseOptions(optStr) {
  if (!optStr) return [];
  return String(optStr).split(',').map(function(o){
    var s = o.trim();
    var ci = s.indexOf(':');
    return ci !== -1 ? s.substring(0, ci).trim() : s;
  }).filter(Boolean);
}

/**
 * Parse options and return [{name, barcode}] objects.
 * Used for barcode matching in scanner.
 */
function parseOptionsWithBarcodes(optStr) {
  if (!optStr) return [];
  return String(optStr).split(',').map(function(o){
    var s = o.trim();
    var ci = s.indexOf(':');
    if (ci !== -1) {
      return { name: s.substring(0, ci).trim(), barcode: s.substring(ci + 1).trim() };
    }
    return { name: s, barcode: '' };
  }).filter(function(o){ return o.name; });
}

function closeQtyModal() {
  document.getElementById('qty-modal').classList.remove('open');
  _qtyProduct = null;
}

function qtyModalBgClick(e) {
  if (e.target === document.getElementById('qty-modal')) closeQtyModal();
}

function changeQty(delta) {
  var max = 999;
  if (_qtyProduct && _qtyProduct.remaining !== null && _qtyProduct.remaining !== undefined && _qtyProduct.remaining !== '') {
    max = Math.max(1, Number(_qtyProduct.remaining) - getCartQty(_qtyProduct.rowIndex));
  }
  _qtyValue = Math.max(1, Math.min(max, _qtyValue + delta));
  document.getElementById('qtyNum').textContent = _qtyValue;
}

function addToCart() {
  if (!_qtyProduct) return;

  var opts = parseOptions(_qtyProduct.options);
  if (opts.length && !_qtyOption) {
    posToast('กรุณาเลือกตัวเลือกก่อน', 'error');
    return;
  }

  // Stock guard — never let the cart exceed what's left
  var rem = _qtyProduct.remaining;
  if (rem !== null && rem !== undefined && rem !== '') {
    var already = getCartQty(_qtyProduct.rowIndex);
    if (already + _qtyValue > Number(rem)) {
      posToast('สต็อกไม่พอ (เหลือ ' + Math.max(0, Number(rem) - already) + ' ชิ้น)', 'error');
      return;
    }
  }

  // Find existing cart line
  var existingIdx = -1;
  for (var i = 0; i < POS_CART.length; i++) {
    if (POS_CART[i].product.rowIndex === _qtyProduct.rowIndex &&
        POS_CART[i].option === _qtyOption) {
      existingIdx = i;
      break;
    }
  }

  if (existingIdx !== -1) {
    POS_CART[existingIdx].qty += _qtyValue;
    POS_CART[existingIdx].lineTotal = POS_CART[existingIdx].qty * Number(_qtyProduct.price);
  } else {
    POS_CART.push({
      product: _qtyProduct,
      qty: _qtyValue,
      option: _qtyOption,
      lineTotal: _qtyValue * Number(_qtyProduct.price)
    });
  }

  closeQtyModal();
  updateCartFab();
  renderProducts(POS_PRODUCTS);  // refresh badges
  posToast('เพิ่มสินค้าแล้ว ✓', 'success');
}

// ══════════════════════════════════
// CART FAB
// ══════════════════════════════════
function updateCartFab() {
  var fab = document.getElementById('posCartFab');
  var totalQty = 0, totalPrice = 0;
  POS_CART.forEach(function(item) { totalQty += item.qty; totalPrice += item.lineTotal; });

  document.getElementById('cartCount').textContent = totalQty;
  document.getElementById('cartTotal').textContent = fmt(totalPrice);

  if (totalQty > 0) fab.classList.add('visible');
  else fab.classList.remove('visible');
}

// ══════════════════════════════════
// SUMMARY
// ══════════════════════════════════
function renderSummary() {
  var container = document.getElementById('summaryContent');
  container.innerHTML = '';

  var totalItems = 0, totalPrice = 0;
  POS_CART.forEach(function(item) { totalItems += item.qty; totalPrice += item.lineTotal; });

  document.getElementById('summarySubTitle').textContent = totalItems + ' รายการ';

  // Items card
  var itemsCard = document.createElement('div');
  itemsCard.className = 'sum-card';
  var itemTitle = document.createElement('div');
  itemTitle.className = 'sum-card-title';
  itemTitle.textContent = '🛒 รายการสินค้า';
  itemsCard.appendChild(itemTitle);

  POS_CART.forEach(function(item, idx) {
    var row = document.createElement('div');
    row.className = 'sum-item';

    // Image
    if (item.product.image) {
      var img = document.createElement('img');
      img.className = 'sum-item-img';
      img.src = item.product.image;
      img.onerror = function() { this.src = PLACEHOLDER; };
      row.appendChild(img);
    } else {
      var ph = document.createElement('div');
      ph.className = 'sum-item-img-placeholder';
      ph.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
      row.appendChild(ph);
    }

    var info = document.createElement('div');
    info.className = 'sum-item-info';
    var nm = document.createElement('div'); nm.className = 'sum-item-name'; nm.textContent = item.product.name; info.appendChild(nm);
    var pr = document.createElement('div'); pr.className = 'sum-item-price';
    pr.textContent = fmt(item.product.price) + (item.option ? ' · ' + item.option : '');
    info.appendChild(pr);
    row.appendChild(info);

    // Controls
    var ctrl = document.createElement('div'); ctrl.className = 'sum-item-controls';
    var minusBtn = document.createElement('button'); minusBtn.className = 'sum-qty-btn'; minusBtn.textContent = '−';
    (function(i){ minusBtn.onclick = function() { adjustSummaryQty(i, -1); }; })(idx);

    var qtySpan = document.createElement('div'); qtySpan.className = 'sum-qty'; qtySpan.textContent = item.qty;

    var plusBtn = document.createElement('button'); plusBtn.className = 'sum-qty-btn'; plusBtn.textContent = '+';
    (function(i){ plusBtn.onclick = function() { adjustSummaryQty(i, 1); }; })(idx);

    ctrl.appendChild(minusBtn); ctrl.appendChild(qtySpan); ctrl.appendChild(plusBtn);
    row.appendChild(ctrl);

    var total = document.createElement('div'); total.className = 'sum-item-total'; total.textContent = fmt(item.lineTotal);
    row.appendChild(total);

    itemsCard.appendChild(row);
  });

  container.appendChild(itemsCard);

  // Totals card
  var totCard = document.createElement('div');
  totCard.className = 'sum-card';

  var subRow = document.createElement('div'); subRow.className = 'sum-total-row';
  subRow.innerHTML = '<span>รวมสินค้า</span><span>' + fmt(totalPrice) + '</span>';
  totCard.appendChild(subRow);

  var grandRow = document.createElement('div'); grandRow.className = 'sum-total-row grand';
  grandRow.innerHTML = '<span>ยอดรวมทั้งหมด</span><span>' + fmt(totalPrice) + '</span>';
  totCard.appendChild(grandRow);

  container.appendChild(totCard);
}

function adjustSummaryQty(idx, delta) {
  var item = POS_CART[idx];
  if (!item) return;
  item.qty = Math.max(0, item.qty + delta);
  if (item.qty === 0) {
    POS_CART.splice(idx, 1);
  } else {
    item.lineTotal = item.qty * Number(item.product.price);
  }
  updateCartFab();
  if (!POS_CART.length) {
    goScreen('pos', 'summary');
    renderProducts(POS_PRODUCTS);
    return;
  }
  renderSummary();
}

// ══════════════════════════════════
// PAYMENT
// ══════════════════════════════════
function renderPayment() {
  var container = document.getElementById('paymentContent');
  container.innerHTML = '';

  var totalPrice = 0;
  POS_CART.forEach(function(item) { totalPrice += item.lineTotal; });

  // Amount hero
  var hero = document.createElement('div');
  hero.className = 'pay-amount-hero';
  hero.innerHTML = '<div class="pay-amount-label">ยอดที่ต้องชำระ</div><div class="pay-amount-value">' + fmt(totalPrice) + '</div>';
  container.appendChild(hero);

  // QR Card
  var qrCard = document.createElement('div');
  qrCard.className = 'pay-qr-card';

  var qrLabel = document.createElement('div');
  qrLabel.style.cssText = 'font-size:0.85rem;font-weight:600;color:var(--text-2);';
  qrLabel.textContent = '📷 QR Code ชำระเงิน';
  qrCard.appendChild(qrLabel);

  var qrWrap = document.createElement('div');
  qrWrap.className = 'pay-qr-wrap';
  qrWrap.id = 'payQrCode';
  qrCard.appendChild(qrWrap);

  var qrSub = document.createElement('div');
  qrSub.className = 'pay-qr-label';
  qrSub.textContent = 'ใช้แอปธนาคารสแกน QR เพื่อชำระเงิน';
  qrCard.appendChild(qrSub);

  container.appendChild(qrCard);

  // Order breakdown
  var orderCard = document.createElement('div');
  orderCard.className = 'pay-order-card';
  var orderTitle = document.createElement('div');
  orderTitle.className = 'pay-order-title';
  orderTitle.textContent = '📦 รายการสั่งซื้อ';
  orderCard.appendChild(orderTitle);

  POS_CART.forEach(function(item) {
    var r = document.createElement('div'); r.className = 'pay-order-row';
    var label = item.product.name + (item.option ? ' (' + item.option + ')' : '') + ' × ' + item.qty;
    var labelSpan = document.createElement('span'); labelSpan.textContent = label;
    var amountSpan = document.createElement('span'); amountSpan.textContent = fmt(item.lineTotal);
    r.appendChild(labelSpan); r.appendChild(amountSpan);
    orderCard.appendChild(r);
  });

  var totalRow = document.createElement('div'); totalRow.className = 'pay-order-row total';
  totalRow.innerHTML = '<span>ยอดรวม</span><span>' + fmt(totalPrice) + '</span>';
  orderCard.appendChild(totalRow);
  container.appendChild(orderCard);

  // Done button
  var doneBtn = document.createElement('button');
  doneBtn.className = 'pay-done-btn';
  doneBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> ชำระเงินแล้ว — บันทึกการขาย';
  doneBtn.onclick = function() { submitPosSale(doneBtn); };
  container.appendChild(doneBtn);

  // Generate QR
  setTimeout(function() {
    var qrEl = document.getElementById('payQrCode');
    if (!qrEl) return;
    qrEl.innerHTML = '';
    try {
      new QRCode(qrEl, {
        text: 'ORDER_HUB|' + POS_LIST_ID + '|' + totalPrice.toFixed(2),
        width: 168,
        height: 168,
        colorDark: '#1A1D3A',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
    } catch(e) {
      qrEl.innerHTML = '<div style="font-size:0.78rem;color:var(--text-3);text-align:center;padding:20px;">QR ไม่พร้อมใช้งาน</div>';
    }
  }, 200);
}

function resetPOS() {
  POS_CART = [];
  updateCartFab();
  renderProducts(POS_PRODUCTS);
  goScreen('pos', null);
  posToast('ชำระเงินเสร็จสิ้น ✓', 'success');
}

// Saves the sale to Supabase (order rows + stock deduction) through
// the atomic submit_pos_sale RPC, then resets for the next customer.
function submitPosSale(btn) {
  if (!POS_CART.length) { resetPOS(); return; }
  var items = POS_CART.map(function(item) {
    return { id: item.product.id, quantity: item.qty, selectedOption: item.option || null };
  });
  var originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ กำลังบันทึกการขาย...';
  function restore() { btn.disabled = false; btn.innerHTML = originalHtml; }

  google.script.run.withSuccessHandler(function(r) {
    try {
      var res = JSON.parse(r);
      if (res.status === 'Success') {
        // Keep on-screen stock in sync without refetching
        POS_CART.forEach(function(item) {
          var rem = item.product.remaining;
          if (rem !== null && rem !== undefined && rem !== '') {
            item.product.remaining = Math.max(0, Number(rem) - item.qty);
          }
        });
        resetPOS();
        posToast('บันทึกการขายแล้ว ✓ (' + (res.saved || items.length) + ' รายการ)', 'success');
      } else {
        restore();
        posToast(res.message || 'บันทึกการขายไม่สำเร็จ', 'error');
      }
    } catch (e) { restore(); posToast('เกิดข้อผิดพลาด', 'error'); }
  }).withFailureHandler(function() {
    restore();
    posToast('บันทึกการขายไม่สำเร็จ — กรุณาลองใหม่', 'error');
  }).adminSubmitPosSale(POS_LIST_ID, items);
}

// ══════════════════════════════════
// SCANNED-CODE HANDLING
// (shared by the camera popup and hardware barcode scanners)
// ══════════════════════════════════
function posStockLeft(product) {
  var rem = product.remaining;
  if (rem === null || rem === undefined || rem === '') return Infinity;
  return Number(rem) - getCartQty(product.rowIndex);
}

function posAddDirect(product, optionName) {
  if (posStockLeft(product) < 1) {
    posToast('สต็อกไม่พอ: ' + product.name, 'error');
    return;
  }
  var existingIdx = -1;
  for (var k = 0; k < POS_CART.length; k++) {
    if (POS_CART[k].product.rowIndex === product.rowIndex && POS_CART[k].option === optionName) {
      existingIdx = k; break;
    }
  }
  if (existingIdx !== -1) {
    POS_CART[existingIdx].qty += 1;
    POS_CART[existingIdx].lineTotal = POS_CART[existingIdx].qty * Number(product.price);
  } else {
    POS_CART.push({ product: product, qty: 1, option: optionName, lineTotal: Number(product.price) });
  }
  updateCartFab();
  renderProducts(POS_PRODUCTS);
  posToast('✓ ' + product.name + (optionName ? ' (' + optionName + ')' : ''), 'success');
}

// Returns true when the code matched a product (and was handled)
function posHandleScannedCode(barcode) {
  barcode = String(barcode || '').trim();
  if (!barcode) return false;

  // Step 1: Match by product ID — exact match, case-insensitive
  var found = null;
  var foundOptionName = null; // set if matched via option barcode
  var bcLower = barcode.toLowerCase();

  for (var i = 0; i < POS_PRODUCTS.length; i++) {
    var p = POS_PRODUCTS[i];
    var pid = String(p.id || '').trim().toLowerCase();
    if (pid && pid === bcLower) { found = p; break; }
  }

  // Step 2: If no product ID match, search option barcodes
  if (!found) {
    for (var i2 = 0; i2 < POS_PRODUCTS.length; i2++) {
      var p2 = POS_PRODUCTS[i2];
      var optsWithBc = parseOptionsWithBarcodes(p2.options);
      for (var j2 = 0; j2 < optsWithBc.length; j2++) {
        var ob = optsWithBc[j2];
        if (ob.barcode && ob.barcode.toLowerCase() === bcLower) {
          found = p2;
          foundOptionName = ob.name;
          break;
        }
      }
      if (found) break;
    }
  }

  if (!found) {
    // No match — show in search bar
    var s = document.getElementById('posSearch');
    s.value = barcode;
    filterProducts(barcode);
    posToast('ไม่พบสินค้า: ' + barcode, 'error');
    return false;
  }

  var opts = parseOptions(found.options);
  if (foundOptionName) {
    posAddDirect(found, foundOptionName);
  } else if (opts.length === 0) {
    posAddDirect(found, '');
  } else {
    // Has options but scanned a product-level barcode — pick option in modal
    openQtyModal(found);
  }
  return true;
}

// ══════════════════════════════════
// BARCODE SCANNER (camera popup)
// ══════════════════════════════════
function openBarcodeScanner() {
  var scanToken = 'pos_scan_' + Date.now();
  var popup = window.open('', 'pos_barcode', 'width=420,height=600,resizable=yes');
  if (!popup) { posToast('กรุณาอนุญาต Pop-up', 'error'); return; }

  function handleBarcodeResult(barcode) {
    barcode = String(barcode || '').trim();
    if (!barcode) return;

    // Close popup AFTER we have the value — not before
    setTimeout(function() {
      try { if (popup && !popup.closed) popup.close(); } catch(e) {}
    }, 100);

    posHandleScannedCode(barcode);
  }

  // Primary bridge — direct function call from popup (same origin)
  window.__posBarcodeResultBridge = function(token, barcode) {
    if (token !== scanToken) return;
    delete window.__posBarcodeResultBridge;
    handleBarcodeResult(barcode);
  };

  // Fallback — postMessage (cross-origin or blocked popup access)
  function onMsg(e) {
    if (e.data && e.data.type === 'POS_BARCODE' && e.data.token === scanToken) {
      window.removeEventListener('message', onMsg);
      delete window.__posBarcodeResultBridge;
      handleBarcodeResult(e.data.barcode);
    }
  }
  window.addEventListener('message', onMsg);

  var popupHtml = [
    '<!DOCTYPE html><html><head><meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>สแกนบาร์โค้ด</title>',
    '<script src="https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js"><\/script>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0;}',
    'body{background:#000;display:flex;flex-direction:column;align-items:center;',
    'justify-content:space-between;height:100vh;font-family:sans-serif;color:#fff;',
    'padding:0;overflow:hidden;}',
    '#reader{width:100vw;flex:1;overflow:hidden;position:relative;}',
    '#reader video{width:100%!important;height:100%!important;object-fit:cover;}',
    /* hide the library's own shading box and border — we style it ourselves */
    '#reader canvas{display:none!important;}',
    '#reader__scan_region{border:none!important;box-shadow:none!important;}',
    '#reader__scan_region img{display:none!important;}',
    /* single clean viewfinder drawn with CSS on the video container */
    '#reader::after{',
    '  content:"";position:absolute;',
    '  top:50%;left:50%;',
    '  transform:translate(-50%,-55%);',
    '  width:260px;height:160px;',
    '  border:3px solid #00C896;border-radius:8px;',
    '  box-shadow:0 0 0 9999px rgba(0,0,0,0.45);',
    '  pointer-events:none;',
    '}',
    '.bottom{width:100%;padding:20px 24px 32px;display:flex;flex-direction:column;',
    'align-items:center;gap:12px;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);}',
    '#status{font-size:0.85rem;color:#aaa;text-align:center;line-height:1.5;}',
    '#result{font-size:1rem;font-weight:700;color:#00C896;text-align:center;',
    'word-break:break-all;min-height:20px;}',
    '#cancelBtn{padding:12px 40px;background:#FF4757;color:#fff;border:none;',
    'border-radius:10px;font-size:0.95rem;font-weight:600;cursor:pointer;width:100%;max-width:320px;}',
    '</style></head><body>',
    '<div id="reader"></div>',
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
    '  var sent=false;',
    '  try{',
    '    if(window.opener&&window.opener.__posBarcodeResultBridge){',
    '      window.opener.__posBarcodeResultBridge(SCAN_TOKEN,text);',
    '      sent=true;',
    '    }',
    '  }catch(e){}',
    '  if(!sent){',
    '    try{',
    '      window.opener&&window.opener.postMessage(',
    '        {type:"POS_BARCODE",token:SCAN_TOKEN,barcode:text},"*"',
    '      );',
    '    }catch(e){}',
    '  }',
    '}',
    'function startScanner(){',
    '  scanner=new Html5Qrcode("reader");',
    '  scanner.start(',
    '    {facingMode:"environment"},',
    '    {fps:15,disableFlip:true},',
    '    function(text){',
    '      if(hasScanned)return;',
    '      if(scanner){try{scanner.stop();}catch(e){}}',
    '      sendResult(text);',
    '    },',
    '    function(){}',
    '  ).then(function(){',
    '    document.getElementById("status").textContent="พร้อมสแกนบาร์โค้ด";',
    '  }).catch(function(e){',
    '    document.getElementById("status").textContent="ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้กล้อง";',
    '  });',
    '}',
    'document.getElementById("cancelBtn").onclick=function(){',
    '  if(scanner){try{scanner.stop();}catch(e){}}',
    '  window.close();',
    '};',
    'window.addEventListener("load",function(){ startScanner(); });',
    '<\/script></body></html>'
  ].join('');

  popup.document.open();
  popup.document.write(popupHtml);
  popup.document.close();
}

// ══════════════════════════════════
// HELPERS
// ══════════════════════════════════
function fmt(n) {
  return new Intl.NumberFormat('th-TH', {style:'currency', currency:'THB'}).format(Number(n) || 0);
}

function posToast(msg, type) {
  var el = document.getElementById('pos-toast');
  el.textContent = msg;
  el.className = type || 'success';
  el.style.display = 'block';
  setTimeout(function() { el.style.display = 'none'; }, 2800);
}

// ── Beep — runs in POS parent window where AudioContext is already unlocked ──
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
    g1.gain.linearRampToValueAtTime(0.6, t + 0.005);
    g1.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o1.start(t);
    o1.stop(t + 0.12);

    // Second tone — subtle harmonic to give it body
    var o2 = _beepCtx.createOscillator();
    var g2 = _beepCtx.createGain();
    o2.connect(g2); g2.connect(_beepCtx.destination);
    o2.type = 'sine';
    o2.frequency.value = 3440;
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.15, t + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o2.start(t);
    o2.stop(t + 0.08);
  } catch(e) {}
};

function showLoading(title, sub) {
  var ov = document.getElementById('pos-loading');
  if (!ov) return;
  document.getElementById('posLoadingTitle').textContent = title || 'กำลังโหลด...';
  document.getElementById('posLoadingSub').textContent   = sub   || 'กรุณารอสักครู่';
  ov.classList.remove('hidden');
}

function hideLoading() {
  var ov = document.getElementById('pos-loading');
  if (ov) ov.classList.add('hidden');
}

// ══════════════════════════════════
// SELF-LOAD — runs on page open
// Reads server-baked vars from POS.html, auths, then fetches products
// ══════════════════════════════════
window.addEventListener('DOMContentLoaded', function() {
  var sheetId  = (typeof POS_INIT_SHEET_ID  !== 'undefined') ? POS_INIT_SHEET_ID  : '';
  var listName = (typeof POS_INIT_LIST_NAME !== 'undefined') ? POS_INIT_LIST_NAME : 'POS';
  var au       = (typeof POS_INIT_AU        !== 'undefined') ? POS_INIT_AU        : '';
  var ap       = (typeof POS_INIT_AP        !== 'undefined') ? POS_INIT_AP        : '';

  // Hardware barcode scanners type the code then send Enter:
  // exact code match adds the item instantly, no camera popup needed.
  var searchInp = document.getElementById('posSearch');
  if (searchInp) {
    searchInp.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var code = searchInp.value.trim();
      if (!code) return;
      if (posHandleScannedCode(code)) {
        searchInp.value = '';
        filterProducts('');
      }
    });
  }

  if (!sheetId) {
    showLoading('ไม่พบรายการสินค้า', 'ปิดหน้าต่างนี้แล้วลองใหม่');
    return;
  }

  document.getElementById('posTitle').textContent = '🖥️ POS — ' + listName;
  showLoading('กำลังเชื่อมต่อ...', listName);

  function loadProducts() {
    showLoading('กำลังโหลดสินค้า...', listName);
    google.script.run
      .withSuccessHandler(function(r) {
        try {
          var res = JSON.parse(r);
          if (res.status !== 'Success') {
            showLoading('โหลดไม่สำเร็จ', res.message || 'กรุณาลองใหม่');
            return;
          }
          openPOS(res.products || [], listName, sheetId);
        } catch(e) {
          showLoading('เกิดข้อผิดพลาด', 'กรุณาปิดและเปิดใหม่');
        }
      })
      .withFailureHandler(function(err) {
        showLoading('โหลดไม่สำเร็จ', (err && err.message) || 'กรุณาลองใหม่');
      })
      .adminGetProducts(sheetId);
  }

  // Auth first so isAdmin_() passes on the server, then load products
  if (au && ap) {
    google.script.run
      .withSuccessHandler(function() { loadProducts(); })
      .withFailureHandler(function()  { loadProducts(); })
      .adminSetSessionToken(au, ap);
  } else {
    loadProducts();
  }
});
