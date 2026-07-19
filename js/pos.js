// ══════════════════════════════════
// STATE
// ══════════════════════════════════
var POS_PRODUCTS = [];      // Loaded from parent / Google Apps Script
var POS_CART = [];          // [{product, qty, option, lineTotal}]
var POS_LIST_NAME = '';
var POS_LIST_ID = '';
var POS_HISTORY_DATA = null;

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
  POS_HISTORY_DATA = null;

  document.getElementById('posTitle').textContent = '🖥️ POS — ' + POS_LIST_NAME;
  document.getElementById('posSub').textContent = POS_PRODUCTS.length + ' รายการสินค้า';
  document.getElementById('posSearch').value = '';

  renderProducts(POS_PRODUCTS);
  updateCartFab();
  goScreen('pos', null);
  hideLoading();

  // Warm up the barcode library in the background so the first
  // scanner tap only has to start the camera
  setTimeout(function() { ensureScannerLib().catch(function() {}); }, 1500);
}

// ══════════════════════════════════
// SCREEN NAVIGATION
// ══════════════════════════════════
var SCREEN_ORDER = ['pos', 'summary', 'payment', 'history'];

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
// POS SALES HISTORY
// ══════════════════════════════════
function openPosHistory() {
  goScreen('history', 'pos');
  var subtitle = document.getElementById('historySubtitle');
  if (subtitle) subtitle.textContent = POS_LIST_NAME || 'ยอดขายหน้าร้าน';
  if (POS_HISTORY_DATA) renderPosHistory(POS_HISTORY_DATA);
  else loadPosHistory(false);
}

function loadPosHistory(force) {
  if (!POS_LIST_ID) { posToast('ไม่พบรายการสินค้า', 'error'); return; }
  if (!force && POS_HISTORY_DATA) { renderPosHistory(POS_HISTORY_DATA); return; }

  var container = document.getElementById('historyContent');
  var refreshBtn = document.getElementById('historyRefreshBtn');
  if (refreshBtn) refreshBtn.disabled = true;
  if (container) container.innerHTML = '<div class="history-loading"><div class="history-spinner"></div><span>กำลังโหลดยอดขาย...</span></div>';

  google.script.run.withSuccessHandler(function(r) {
    if (refreshBtn) refreshBtn.disabled = false;
    try {
      var res = JSON.parse(r);
      if (res.status !== 'Success') {
        renderPosHistoryError(res.message || 'โหลดประวัติการขายไม่สำเร็จ');
        return;
      }
      POS_HISTORY_DATA = res;
      renderPosHistory(res);
    } catch (e) { renderPosHistoryError('อ่านข้อมูลประวัติการขายไม่สำเร็จ'); }
  }).withFailureHandler(function() {
    if (refreshBtn) refreshBtn.disabled = false;
    renderPosHistoryError('โหลดประวัติการขายไม่สำเร็จ — กรุณาลองใหม่');
  }).adminGetPosHistory(POS_LIST_ID);
}

function renderPosHistoryError(message) {
  var container = document.getElementById('historyContent');
  if (!container) return;
  container.innerHTML = '';
  var empty = document.createElement('div'); empty.className = 'history-empty';
  empty.innerHTML = '<div style="font-size:2rem;">⚠️</div>';
  var text = document.createElement('div'); text.textContent = message;
  empty.appendChild(text); container.appendChild(empty);
}

function renderPosHistory(data) {
  var container = document.getElementById('historyContent');
  if (!container) return;
  container.innerHTML = '';

  var hero = document.createElement('div'); hero.className = 'history-hero';
  var heroLabel = document.createElement('div'); heroLabel.className = 'history-hero-label'; heroLabel.textContent = 'ยอดขายรวมทั้งหมด';
  var heroValue = document.createElement('div'); heroValue.className = 'history-hero-value'; heroValue.textContent = fmt(data.totalSales || 0);
  var heroSub = document.createElement('div'); heroSub.className = 'history-hero-sub'; heroSub.textContent = 'เฉพาะยอดขายที่บันทึกผ่าน POS ของรายการนี้';
  hero.appendChild(heroLabel); hero.appendChild(heroValue); hero.appendChild(heroSub); container.appendChild(hero);

  var stats = document.createElement('div'); stats.className = 'history-stats';
  function addStat(label, value) {
    var card = document.createElement('div'); card.className = 'history-stat';
    var l = document.createElement('div'); l.className = 'history-stat-label'; l.textContent = label;
    var v = document.createElement('div'); v.className = 'history-stat-value'; v.textContent = value;
    card.appendChild(l); card.appendChild(v); stats.appendChild(card);
  }
  addStat('ยอดขายวันนี้', fmt(data.todaySales || 0));
  addStat('จำนวนออเดอร์', Number(data.transactionCount || 0).toLocaleString('th-TH') + ' รายการ');
  container.appendChild(stats);

  if (data.truncated) {
    var warning = document.createElement('div'); warning.className = 'history-warning';
    warning.textContent = 'ข้อมูลมีมากกว่า 100,000 รายการ ยอดรวมนี้อาจไม่ครบทั้งหมด';
    container.appendChild(warning);
  }

  var sales = data.sales || [];
  var sectionHead = document.createElement('div'); sectionHead.className = 'history-section-head';
  var sectionTitle = document.createElement('div'); sectionTitle.className = 'history-section-title'; sectionTitle.textContent = 'ออเดอร์ล่าสุด';
  var sectionCount = document.createElement('div'); sectionCount.className = 'history-section-count';
  sectionCount.textContent = sales.length + ' จาก ' + Number(data.transactionCount || 0).toLocaleString('th-TH');
  sectionHead.appendChild(sectionTitle); sectionHead.appendChild(sectionCount); container.appendChild(sectionHead);

  if (!sales.length) {
    var empty = document.createElement('div'); empty.className = 'history-empty';
    empty.innerHTML = '<div style="font-size:2.2rem;">🧾</div><div>ยังไม่มีประวัติการขายผ่าน POS</div>';
    container.appendChild(empty); return;
  }

  sales.forEach(function(sale) {
    var card = document.createElement('div'); card.className = 'history-sale-card';
    var head = document.createElement('div'); head.className = 'history-sale-head';
    var left = document.createElement('div');
    var time = document.createElement('div'); time.className = 'history-sale-time';
    var stamp = new Date(sale.createdAt);
    time.textContent = isNaN(stamp.getTime()) ? 'ไม่ทราบเวลา' : stamp.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
    var meta = document.createElement('div'); meta.className = 'history-sale-meta';
    meta.textContent = Number(sale.quantity || 0).toLocaleString('th-TH') + ' ชิ้น · ' + (sale.items || []).length + ' รายการสินค้า';
    left.appendChild(time); left.appendChild(meta);
    var total = document.createElement('div'); total.className = 'history-sale-total'; total.textContent = fmt(sale.total || 0);
    head.appendChild(left); head.appendChild(total); card.appendChild(head);

    var items = document.createElement('div'); items.className = 'history-sale-items';
    (sale.items || []).forEach(function(item) {
      var row = document.createElement('div'); row.className = 'history-sale-item';
      var name = document.createElement('span'); name.textContent = item.product || 'สินค้า';
      var amount = document.createElement('span'); amount.textContent = '×' + Number(item.qty || 0).toLocaleString('th-TH') + ' · ' + fmt(item.total || 0);
      row.appendChild(name); row.appendChild(amount); items.appendChild(row);
    });
    card.appendChild(items); container.appendChild(card);
  });

  if (data.historyLimited) {
    var limited = document.createElement('div'); limited.className = 'history-warning';
    limited.textContent = 'แสดง 100 ออเดอร์ล่าสุด โดยยอดขายรวมยังคำนวณจากข้อมูลทั้งหมด';
    container.appendChild(limited);
  }
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
    card.setAttribute('data-search', ((p.name || '') + ' ' + (p.barcode || p.id || '')).toLowerCase());

    // Image
    if (p.image) {
      var img = document.createElement('img');
      img.className = 'pos-prod-img';
      img.src = p.image;
      img.loading = 'lazy';
      img.decoding = 'async';
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

  // Re-apply an active search so badge refreshes don't reset the filter
  var searchBox = document.getElementById('posSearch');
  if (searchBox && searchBox.value.trim()) filterProducts(searchBox.value);
}

// Show/hide the already-rendered cards instead of rebuilding the grid —
// rebuilding forced every product image to re-decode on each keystroke
function filterProducts(term) {
  term = (term || '').trim().toLowerCase();
  var grid = document.getElementById('posProductGrid');
  var empty = document.getElementById('posEmpty');
  var cards = grid.children;
  var visible = 0;
  for (var i = 0; i < cards.length; i++) {
    var show = !term || (cards[i].getAttribute('data-search') || '').indexOf(term) !== -1;
    cards[i].style.display = show ? '' : 'none';
    if (show) visible++;
  }
  grid.style.display = visible ? 'grid' : 'none';
  empty.style.display = visible ? 'none' : 'flex';
}

function getCartQty(rowIndex) {
  var total = 0;
  POS_CART.forEach(function(item) {
    if (item.product.rowIndex === rowIndex) total += item.qty;
  });
  return total;
}

function getCartQtyForOption(rowIndex, optionName) {
  var total = 0;
  POS_CART.forEach(function(item) {
    if (item.product.rowIndex === rowIndex && item.option === (optionName || '')) total += item.qty;
  });
  return total;
}

function getProductOptions(product) {
  var details = product && Array.isArray(product.optionDetails) ? product.optionDetails : [];
  if (details.length) {
    return details.map(function(opt) {
      return {
        name: String(opt.name || '').trim(),
        barcode: String(opt.code || opt.barcode || '').trim(),
        image: String(opt.image || '').trim(),
        remaining: opt.remaining === null || opt.remaining === undefined || opt.remaining === ''
          ? null : Number(opt.remaining)
      };
    }).filter(function(opt) { return opt.name; });
  }
  return parseOptionsWithBarcodes(product ? product.options : '').map(function(opt) {
    return { name: opt.name, barcode: opt.barcode, image: '', remaining: null };
  });
}

function getOptionDetail(product, optionName) {
  var wanted = String(optionName || '').trim();
  var opts = getProductOptions(product);
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].name === wanted) return opts[i];
  }
  return null;
}

function hasTrackedStock(value) {
  return value !== null && value !== undefined && value !== '' && isFinite(Number(value));
}

function posStockLeft(product, optionName) {
  var parentLeft = Infinity;
  if (hasTrackedStock(product.remaining)) {
    parentLeft = Number(product.remaining) - getCartQty(product.rowIndex);
  }

  var optionLeft = Infinity;
  if (optionName) {
    var detail = getOptionDetail(product, optionName);
    if (detail && hasTrackedStock(detail.remaining)) {
      optionLeft = Number(detail.remaining) - getCartQtyForOption(product.rowIndex, optionName);
    }
  }
  return Math.min(parentLeft, optionLeft);
}

// ══════════════════════════════════
// QTY MODAL
// ══════════════════════════════════
function openQtyModal(product) {
  _qtyProduct = product;
  _qtyValue = 1;
  _qtyOption = '';

  document.getElementById('qtyModalName').textContent = product.name;
  document.getElementById('qtyNum').textContent = '1';

  // Options
  var opts = getProductOptions(product);
  var optSec = document.getElementById('qtyOptionsSection');
  var optContainer = document.getElementById('qtyOptions');
  optContainer.innerHTML = '';

  if (opts.length) {
    var available = opts.filter(function(opt) { return posStockLeft(product, opt.name) > 0; });
    _qtyOption = (available[0] || opts[0]).name;
    optSec.style.display = 'block';
    opts.forEach(function(opt) {
      var chip = document.createElement('button');
      var left = posStockLeft(product, opt.name);
      chip.className = 'qty-opt-chip' + (opt.name === _qtyOption ? ' selected' : '');
      chip.textContent = opt.name + (hasTrackedStock(opt.remaining) ? ' (' + Math.max(0, Number(opt.remaining)) + ')' : '');
      chip.disabled = left < 1;
      chip.onclick = function() {
        _qtyOption = opt.name;
        _qtyValue = 1;
        optContainer.querySelectorAll('.qty-opt-chip').forEach(function(c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        updateQtyModalState();
      };
      optContainer.appendChild(chip);
    });
  } else {
    optSec.style.display = 'none';
  }

  updateQtyModalState();
  document.getElementById('qty-modal').classList.add('open');
}

function renderQtyModalImage(product, option) {
  var imgWrap = document.getElementById('qtyModalImg');
  imgWrap.innerHTML = '';
  var imageUrl = option && option.image ? option.image : product.image;
  if (imageUrl) {
    var img = document.createElement('img');
    img.className = 'qty-modal-img';
    img.src = imageUrl;
    img.onerror = function() { this.src = PLACEHOLDER; };
    imgWrap.appendChild(img);
  } else {
    var ph = document.createElement('div');
    ph.className = 'qty-modal-img-placeholder';
    ph.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    imgWrap.appendChild(ph);
  }
}

function updateQtyModalState() {
  if (!_qtyProduct) return;
  var option = _qtyOption ? getOptionDetail(_qtyProduct, _qtyOption) : null;
  var left = posStockLeft(_qtyProduct, _qtyOption);
  if (isFinite(left)) _qtyValue = Math.min(_qtyValue, Math.max(1, Math.floor(left)));
  document.getElementById('qtyNum').textContent = _qtyValue;
  var priceText = fmt(_qtyProduct.price) + ' / ชิ้น';
  if (isFinite(left)) priceText += ' · เหลือ ' + Math.max(0, left) + ' ชิ้น';
  document.getElementById('qtyModalPrice').textContent = priceText;
  var addBtn = document.getElementById('qtyAddBtn');
  if (addBtn) addBtn.disabled = left < 1;
  renderQtyModalImage(_qtyProduct, option);
}

function updateOptionDetailRemaining(product, optionName, quantity) {
  if (!product || !Array.isArray(product.optionDetails)) return;
  product.optionDetails.forEach(function(opt) {
    if (String(opt.name || '').trim() === String(optionName || '').trim() && hasTrackedStock(opt.remaining)) {
      opt.remaining = Math.max(0, Number(opt.remaining) - Number(quantity || 0));
    }
  });
}

function getProductImage(product, optionName) {
  var detail = getOptionDetail(product, optionName);
  return detail && detail.image ? detail.image : product.image;
}

function getProductOptionNames(product) {
  return getProductOptions(product).map(function(opt) { return opt.name; });
}

function ensureQtyAvailable(product, optionName, requestedQty) {
  var left = posStockLeft(product, optionName);
  if (left < requestedQty) {
    posToast('สต็อกไม่พอ (เหลือ ' + Math.max(0, left) + ' ชิ้น)', 'error');
    return false;
  }
  return true;
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
  var max = _qtyProduct ? posStockLeft(_qtyProduct, _qtyOption) : 999;
  if (!isFinite(max)) max = 999;
  max = Math.max(1, Math.floor(max));
  _qtyValue = Math.max(1, Math.min(max, _qtyValue + delta));
  updateQtyModalState();
}

function addToCart() {
  if (!_qtyProduct) return;

  var opts = getProductOptionNames(_qtyProduct);
  if (opts.length && !_qtyOption) {
    posToast('กรุณาเลือกตัวเลือกก่อน', 'error');
    return;
  }

  // Enforce both the option stock and the overall product stock.
  if (!ensureQtyAvailable(_qtyProduct, _qtyOption, _qtyValue)) return;

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
    var itemImage = getProductImage(item.product, item.option);
    if (itemImage) {
      var img = document.createElement('img');
      img.className = 'sum-item-img';
      img.src = itemImage;
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
  if (delta > 0 && !ensureQtyAvailable(item.product, item.option, delta)) return;
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

  // Payment card — the shop's real payment channels (same as the
  // customer page). The old generated QR encoded an internal string
  // that no banking app could actually pay.
  var qrCard = document.createElement('div');
  qrCard.className = 'pay-qr-card';

  var qrLabel = document.createElement('div');
  qrLabel.style.cssText = 'font-size:0.85rem;font-weight:600;color:var(--text-2);';
  qrLabel.textContent = '💳 ช่องทางการชำระเงิน';
  qrCard.appendChild(qrLabel);

  var qrWrap = document.createElement('div');
  qrWrap.className = 'pay-qr-wrap';
  var qrImg = document.createElement('img');
  qrImg.src = 'https://i.imgur.com/LDTUtnz.jpeg';
  qrImg.alt = 'QR ชำระเงินของร้าน';
  qrImg.style.cssText = 'width:168px;height:auto;border-radius:8px;display:block;margin:0 auto;';
  qrWrap.appendChild(qrImg);
  qrCard.appendChild(qrWrap);

  var payInfo = document.createElement('div');
  payInfo.className = 'pay-qr-label';
  payInfo.style.cssText = 'line-height:1.7;text-align:center;';
  payInfo.innerHTML = 'TrueMoney: 0802927553<br>ธนาคารกสิกร: 094-8-44664-2<br>ชื่อบัญชี: ปิยธิดา ก.';
  qrCard.appendChild(payInfo);

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
var _posCheckoutId = null;
function submitPosSale(btn) {
  if (!POS_CART.length) { resetPOS(); return; }
  // Same id across retries of this payment → no duplicate sales
  _posCheckoutId = _posCheckoutId || (window.__newCheckoutId ? window.__newCheckoutId() : null);
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
          updateOptionDetailRemaining(item.product, item.option, item.qty);
        });
        _posCheckoutId = null; // next sale gets a fresh checkout id
        POS_HISTORY_DATA = null; // refresh totals/history after the next open
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
  }).adminSubmitPosSale(POS_LIST_ID, items, _posCheckoutId);
}

// ══════════════════════════════════
// SCANNED-CODE HANDLING
// (shared by the camera popup and hardware barcode scanners)
// ══════════════════════════════════
function posAddDirect(product, optionName) {
  if (posStockLeft(product, optionName) < 1) {
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
      var optsWithBc = getProductOptions(p2);
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

  var opts = getProductOptions(found);
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
// BARCODE SCANNER (in-page overlay — no popup, so no popup blockers,
// no new tab on mobile, and the camera permission sticks to this page)
// ══════════════════════════════════
var _posScanner = null;        // reused Html5Qrcode instance
var _posScannerActive = false;
var _scannerLibPromise = null;

function ensureScannerLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (_scannerLibPromise) return _scannerLibPromise;
  _scannerLibPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = resolve;
    s.onerror = function() { _scannerLibPromise = null; reject(new Error('scanner lib load failed')); };
    document.head.appendChild(s);
  });
  return _scannerLibPromise;
}

function openBarcodeScanner() {
  var ov = document.getElementById('pos-scanner-overlay');
  var status = document.getElementById('posScanStatus');
  if (!ov) return;
  ov.classList.add('open');
  status.textContent = 'กำลังเปิดกล้อง...';

  ensureScannerLib().then(function() {
    if (_posScannerActive) return;
    if (!_posScanner) _posScanner = new Html5Qrcode('posScanReader');
    _posScannerActive = true;
    var scanned = false;
    _posScanner.start(
      { facingMode: 'environment' },
      { fps: 15, disableFlip: true },
      function(text) {
        if (scanned) return;
        scanned = true;
        try { playBeep(); } catch(e) {}
        closeBarcodeScanner();
        posHandleScannedCode(String(text || '').trim());
      },
      function() {}
    ).then(function() {
      status.textContent = 'พร้อมสแกนบาร์โค้ด';
    }).catch(function() {
      _posScannerActive = false;
      status.textContent = 'ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการใช้กล้อง';
    });
  }).catch(function() {
    status.textContent = 'โหลดตัวสแกนไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต';
  });
}

function closeBarcodeScanner() {
  var ov = document.getElementById('pos-scanner-overlay');
  if (ov) ov.classList.remove('open');
  if (_posScanner && _posScannerActive) {
    _posScannerActive = false;
    try { _posScanner.stop().catch(function() {}); } catch(e) {}
  }
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

  // The Supabase session is shared with the admin page — no URL credentials
  loadProducts();
});
