var PLACEHOLDER = 'https://www.svgrepo.com/show/508699/landscape-placeholder.svg';
var products = [], cart = [], cartIdSeq = 0;
var currentOrder = null, isSubmitted = false, summaryCache = null;
var selectedSheetId = null, hubOrderLists = [];
var html2CanvasLoader = null;

function isValidPhone(p) { return /^0[6-9]\d{8}$/.test(p.replace(/[-\s]/g,'')); }

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getOrderListMetaBySheetId(sheetId) {
  for (var i = 0; i < hubOrderLists.length; i++) {
    if (hubOrderLists[i].sheetId === sheetId) return hubOrderLists[i];
  }
  return null;
}

function setWorkbookNameBySheetId(sheetId) {
  var el = document.getElementById('workbookName');
  if (!el) return;
  var meta = getOrderListMetaBySheetId(sheetId);
  el.textContent = meta && meta.name ? meta.name : 'รายการสั่งซื้อ';
}

function highlightInputError(elId) {
  var el = document.getElementById(elId); if (!el) return;
  el.focus();
  var g = el.parentElement;
  if (g) { g.style.borderColor='var(--error)'; g.style.boxShadow='0 0 0 3px var(--error-light)'; setTimeout(function(){g.style.borderColor='';g.style.boxShadow='';},2500); }
}

function showMessage(text, type) {
  var el = document.getElementById('message');
  el.textContent = String(text || ''); el.className = 'message ' + type; el.style.display = 'block';
  setTimeout(function(){el.style.display='none';}, 4000);
}

function formatCurrency(n) { return new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n); }
function safeImg(u) {
  try {
    var parsed = new URL(String(u || ''), location.href);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : PLACEHOLDER;
  } catch (e) { return PLACEHOLDER; }
}
// Card-sized copy for display (cdnThumb in api.js); saved cart and order data keep the original link
function thumbImg(u, w) { return window.cdnThumb ? cdnThumb(safeImg(u), w) : safeImg(u); }

function ensureHtml2Canvas() {
  if (typeof window.html2canvas === 'function') return Promise.resolve(window.html2canvas);
  if (html2CanvasLoader) return html2CanvasLoader;
  html2CanvasLoader = new Promise(function(resolve, reject) {
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
    script.async = true;
    script.onload = function() {
      if (typeof window.html2canvas === 'function') resolve(window.html2canvas);
      else reject(new Error('html2canvas did not initialize'));
    };
    script.onerror = function() { reject(new Error('Unable to load html2canvas')); };
    document.head.appendChild(script);
  });
  return html2CanvasLoader;
}
function sid(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g,'_'); }

// Options are stored as "name:barcode" — customers must only ever see
// the name. The raw value is still submitted so the server can match it.
function optLabel(o){
  var s=String(o||''); var ci=s.indexOf(':');
  return ci===-1 ? s : s.slice(0,ci).trim();
}

function cartTotal() { var s=0; for(var i=0;i<cart.length;i++) s+=cart[i].unitPrice*cart[i].qty; return s; }
function cartCount() { var s=0; for(var i=0;i<cart.length;i++) s+=cart[i].qty; return s; }

// ── Free gifts: progress toward the current list's thresholds ──
// Mirrors submit_order (which decides for real): ¥ rules compare the yuan
// value of the goods, ฿ rules the full-price value — deposits count in full.
function giftStatus(items) {
  var meta = getOrderListMetaBySheetId(selectedSheetId) || {};
  var rules = meta.giftRules || [];
  if (!rules.length) return null;
  // Gifts count the customer's whole round: what they ordered before + this cart
  var yuan = giftBase.yuan, full = giftBase.full;
  (items || cart).forEach(function(ci) {
    var p = findProduct(ci.productId || ci.id) || {};
    var q = Number(ci.qty || ci.quantity) || 0;
    yuan += (Number(p.yuan) || 0) * q;
    full += (Number(ci.fullPrice !== undefined ? ci.fullPrice : p.price) || 0) * q;
  });
  // "every" rules give one per every min spent (¥1591 at ¥66 = 24), the rest give one
  function count(g, have) {
    var n = have >= g.min ? (g.every ? Math.floor(have / g.min) : 1) : 0;
    return g.stock !== null ? Math.min(n, g.stock) : n;
  }
  var rows = rules.map(function(g) {
    var have = g.currency === 'CNY' ? yuan : full, before = g.currency === 'CNY' ? giftBase.yuan : giftBase.full;
    return { rule: g, have: have, reached: have >= g.min, out: g.stock !== null && g.stock <= 0, n: count(g, have), n0: count(g, before) };
  });
  function pick(key) {
    var w = rows.filter(function(r) { return r[key] > 0; });
    return meta.giftMode === 'best' && w.length > 1 ? [w[w.length - 1]] : w;
  }
  var winners = pick('n'), had = pick('n0');
  rows.forEach(function(r) {
    r.win = winners.indexOf(r) !== -1;
    // What this order adds on top of the gifts earlier orders already earned
    r.add = r.win ? r.n - (had.indexOf(r) !== -1 ? r.n0 : 0) : 0;
    r.label = r.rule.name + (r.add > 1 ? ' ×' + r.add : '');
  });
  return { rows: rows, mode: meta.giftMode, winners: winners.filter(function(r) { return r.add > 0; }) };
}
var giftBase = { yuan: 0, full: 0 };
function loadGiftBase() {
  giftBase = { yuan: 0, full: 0 };
  renderGiftNudge();
  var sheet = selectedSheetId, name = (document.getElementById('customerName').value || '').trim();
  if (!sheet || !name) return;
  google.script.run.withSuccessHandler(function(r) {
    try { var res = JSON.parse(r); if (res.status === 'Success' && sheet === selectedSheetId) { giftBase = { yuan: res.yuan, full: res.full }; renderGiftBox(); renderGiftNudge(); } } catch (e) {}
  }).customerListTotals(sheet, name);
}
// Customers pay in baht but ¥ rules count yuan. The baht shown is the most it can
// take: the gap at this round's highest ฿-per-¥, rounded up to ฿10 — spending that
// much always reaches the gift (a little less is often enough), so it is no estimate.
function bahtPerYuan() {
  var top = 0;
  products.forEach(function(p) { if (Number(p.yuan) > 0 && Number(p.price) > 0) top = Math.max(top, p.price / p.yuan); });
  return top;
}
function giftMoney(n, cur) {
  if (cur !== 'CNY') return shortPrice(n);
  var rate = bahtPerYuan();
  return rate ? shortPrice(Math.ceil(Math.round(n * rate * 100) / 1000) * 10) : '¥' + (Number(n) || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
}
// "ของแถมโปสการ์ด…" → "โปสการ์ด…": the sentence around it already says ของแถม
function giftName(g) { return String(g.name || '').replace(/^ของแถม\s*/, '') || 'ของแถม'; }
// Cart box: one plain row per gift — got it / "ขาดอีก ฿300" with a thin bar / sold out —
// and, under them, the cheapest product that reaches the next gift
function renderGiftBox() {
  var box = document.getElementById('cartGifts'); if (!box) return;
  var st = giftStatus();
  if (!st) { box.style.display = 'none'; box.innerHTML = ''; return; }
  var html = '<div class="gift-title">ของแถม' + (st.mode === 'best' ? ' <span class="gift-mode">รับ 1 ชิ้น (ชิ้นที่ดีที่สุดที่ถึง)</span>' : '') + '</div>';
  st.rows.forEach(function(r) {
    var g = r.rule, cls, right;
    if (r.out) { cls = 'out'; right = 'หมดแล้ว'; }
    else if (r.win) { cls = 'win'; right = 'ได้แล้ว' + (r.n > 1 ? ' ×' + r.n : '') + ' ✓'; }
    else if (r.reached) { cls = 'pass'; right = 'ได้ชิ้นที่ใหญ่กว่า'; }
    else { cls = 'next'; right = 'ขาดอีก ' + giftMoney(g.min - r.have, g.currency); }
    var pct = Math.max(0, Math.min(100, Math.round(r.have / g.min * 100)));
    // "Every" gifts keep going: show how far the next one is
    var more = '';
    if (cls === 'win' && g.every && (g.stock === null || r.n < g.stock)) {
      pct = Math.round((r.have % g.min) / g.min * 100);
      more = '<div class="gift-more">ขาดอีก ' + escapeHtml(giftMoney(g.min - r.have % g.min, g.currency)) + ' ได้เพิ่มอีกชิ้น</div>';
    }
    html += '<div class="gift-row ' + cls + '"><div class="gift-line"><span class="gift-name">' + escapeHtml(giftName(g)) +
      '</span><span class="gift-state">' + escapeHtml(right) + '</span></div>' +
      (cls === 'next' || more ? '<div class="gift-bar"><i style="width:' + pct + '%"></i></div>' : '') + more + '</div>';
  });
  var next = giftNext(st), p = next && cart.length ? giftSuggest(next) : null;
  if (p) {
    html += '<button type="button" class="gift-tip" data-psid="' + sid(p.id) + '"><img src="' + escapeHtml(thumbImg(p.image, 160)) + '" alt="">' +
      '<span class="gift-tip-text"><small>เพิ่มชิ้นนี้ก็ได้ของแถมเลย</small><b>' + escapeHtml(p.name || '') + '</b></span>' +
      '<span class="gift-tip-price">' + shortPrice(p.price) + ' &rsaquo;</span></button>';
  }
  box.innerHTML = html; box.style.display = '';
  var tip = box.querySelector('.gift-tip');
  if (tip) tip.onclick = function() { closeCart(); showProduct(tip.getAttribute('data-psid')); };
}
// Bring a product card into view and flash it (clears a search / tag that hides it)
function showProduct(psid) {
  var btn = document.querySelector('#productTable .atcbtn[data-psid="' + psid + '"]');
  var row = btn && btn.closest('tr'); if (!row) return;
  if (row.style.display === 'none') { var s = document.getElementById('productSearch'); if (s) s.value = ''; activeTag = ''; applyProductTags(); }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('gn-flash'); void row.offsetWidth; row.classList.add('gn-flash');
}

// The gift closest to being earned: { row, gap, pct } — null when nothing is left to earn
function giftNext(st) {
  var best = null;
  st.rows.forEach(function(r) {
    var g = r.rule, done = 0;
    if (r.out) return;
    if (g.every) { done = Math.floor(r.have / g.min); if (g.stock !== null && done >= g.stock) return; }
    else if (r.reached) return;
    var from = done * g.min, pct = (r.have - from) / g.min;
    if (!best || pct > best.pct) best = { row: r, gap: from + g.min - r.have, pct: pct };
  });
  return best;
}
// Cheapest product on sale that alone covers the gap to the next gift
function giftSuggest(next) {
  var cny = next.row.rule.currency === 'CNY', pick = null, pv = 0;
  products.forEach(function(p) {
    if (p.remaining !== Infinity && p.remaining <= cartQtyOfProduct(p.id)) return;
    var v = Number(cny ? p.yuan : p.price) || 0;
    if (v >= next.gap && (!pick || v < pv)) { pick = p; pv = v; }
  });
  return pick;
}
// One line above the cart button: "ขาดอีก ฿300 จะได้ของแถม … ฟรี". Tap → the cart,
// where every gift and the suggested product are listed.
function renderGiftNudge() {
  var box = document.getElementById('giftNudge'); if (!box) return;
  var st = selectedSheetId ? giftStatus() : null, text = '', pct = 100;
  if (st) {
    var next = giftNext(st), got = st.rows.filter(function(r) { return r.win; });
    if (!next) text = got.length ? 'ได้ของแถมครบแล้ว ✓' : '';
    else {
      var g = next.row.rule, gap = '<b>' + escapeHtml(giftMoney(next.gap, g.currency)) + '</b>';
      pct = Math.round(next.pct * 100);
      text = next.row.n > 0 ? 'ได้ของแถมแล้ว ×' + next.row.n + ' · ขาดอีก ' + gap + ' ได้เพิ่มอีกชิ้น'
        : (!cart.length && next.row.have <= 0 ? 'ซื้อครบ ' : 'ขาดอีก ') + gap + ' จะได้ของแถม ' + escapeHtml(giftName(g)) + ' ฟรี';
    }
  }
  document.body.classList.toggle('has-gift-nudge', !!text);
  box.hidden = !text;
  box.innerHTML = text ? '<span class="gn-text">' + text + '</span><span class="gn-go" aria-hidden="true">&rsaquo;</span><i class="gn-line" style="width:' + pct + '%"></i>' : '';
  box.onclick = openCart;
}

function updateCartBadge() {
  renderGiftBox(); renderGiftNudge();
  var n = cartCount();
  var badge = document.getElementById('cartBadge');
  badge.textContent = n;
  if (n>0) badge.classList.add('visible'); else badge.classList.remove('visible');
  document.getElementById('cartTotal').textContent = formatCurrency(cartTotal());
  document.getElementById('checkoutBtn').disabled = (cart.length===0);
}

function openCart() {
  if (!document.getElementById('customerName').value.trim()) { showMessage('กรุณากรอกชื่อลูกค้าก่อนนะคะ','error'); return; }
  document.getElementById('cartSidebar').classList.add('open');
  document.getElementById('cartOverlay').classList.add('open');
  renderCartSidebar();
}
function closeCart() {
  document.getElementById('cartSidebar').classList.remove('open');
  document.getElementById('cartOverlay').classList.remove('open');
}

function findProduct(id) { for(var i=0;i<products.length;i++) if(products[i].id===id) return products[i]; return null; }
function findProductBySid(s) { for(var i=0;i<products.length;i++) if(sid(products[i].id)===s) return products[i]; return null; }
function findCartItem(cartId) { for(var i=0;i<cart.length;i++) if(cart[i].cartId===cartId) return cart[i]; return null; }

function cartQtyOfProduct(productId){
  var s=0; for(var i=0;i<cart.length;i++) if(cart[i].productId===productId) s+=cart[i].qty; return s;
}

function addToCart(productId) {
  var product = findProduct(productId); if (!product) return;
  var option = null;
  if (product.options && product.options.length > 0) {
    option = product.pendingOption || null;
    if (!option) {
      showMessage('กรุณาเลือกตัวเลือกก่อนเพิ่มลงตะกร้า','error');
      var s2 = sid(productId);
      var optEl = document.getElementById('popt-'+s2);
      if (optEl) { optEl.classList.add('invalid'); setTimeout(function(){optEl.classList.remove('invalid');},2000); }
      return;
    }
  }
  // Stock guard — cart can never exceed what's left
  if (product.remaining !== Infinity) {
    if (product.remaining <= 0) { showMessage('สินค้าหมดแล้วค่ะ','error'); return; }
    if (cartQtyOfProduct(productId) + 1 > product.remaining) {
      showMessage('สินค้ามีไม่พอค่ะ (เหลือ '+product.remaining+' ชิ้น)','error');
      return;
    }
  }
  // A ฿0/blank deposit can never be used to reserve stock for free
  var isDeposit = !!product.pendingDeposit && Number(product.deposit) > 0;
  var unitPrice = isDeposit ? (product.deposit||0) : (product.price||0);
  var existing = null;
  for(var i=0;i<cart.length;i++) if(cart[i].productId===productId && cart[i].option===option && cart[i].isDeposit===isDeposit){existing=cart[i];break;}
  if (existing) { existing.qty+=1; }
  else { cart.push({cartId:++cartIdSeq,productId:productId,name:product.name||'',image:safeImg(product.image),option:option,options:product.options||[],qty:1,unitPrice:unitPrice,fullPrice:product.price||0,depositPrice:product.deposit||0,isDeposit:isDeposit}); }
  var s3 = sid(productId);
  var selEl = document.getElementById('popt-'+s3);
  if (selEl) {
    if (selEl.tagName==='SELECT') selEl.value='';
    else { var chips=selEl.querySelectorAll('.option-chip'); for(var k=0;k<chips.length;k++) chips[k].classList.remove('selected'); }
  }
  product.pendingOption = null;
  var btn = document.getElementById('cartBarBtn');
  btn.classList.remove('bounce'); setTimeout(function(){btn.classList.add('bounce');},10); setTimeout(function(){btn.classList.remove('bounce');},400);
  updateCartBadge();
  showMessage('เพิ่ม "' + product.name + (option?' ('+optLabel(option)+')':'') + '" ลงตะกร้าแล้ว', 'success');
}

function addToCartBySid(s) { var p=findProductBySid(s); if(p) addToCart(p.id); }

function renderCartSidebar() {
  var list = document.getElementById('cartItemsList');
  if (cart.length===0) {
    list.innerHTML = '<div class="cart-empty"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="opacity:0.2;"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span>ตะกร้าว่างเปล่า</span><span style="font-size:0.8rem;color:var(--text-3);">เพิ่มสินค้าด้านล่างได้เลยค่ะ</span></div>';
    updateCartBadge(); return;
  }
  var html='';
  for(var i=0;i<cart.length;i++){
    var item=cart[i];
    var oe='';
    if(item.options && item.options.length>0){
      oe='<select class="cart-option-edit" data-cid="'+item.cartId+'" aria-label="เปลี่ยนตัวเลือกของ '+escapeHtml(item.name)+'">';
      for(var j=0;j<item.options.length;j++) oe+='<option value="'+escapeHtml(item.options[j])+'"'+(item.options[j]===item.option?' selected':'')+'>'+escapeHtml(optLabel(item.options[j]))+'</option>';
      oe+='</select>';
    }
    var pill = item.option ? '<div class="cart-item-option-pill">'+escapeHtml(optLabel(item.option))+'</div>' : '';
    var ptc = item.isDeposit ? 'deposit' : 'full';
    var ptl = item.isDeposit ? 'มัดจำ' : 'ราคาเต็ม';
    html+='<div class="cart-item" id="ci-'+item.cartId+'">';
    html+='<div class="cart-item-header">';
    html+='<img src="'+escapeHtml(thumbImg(item.image, 160))+'" class="cart-item-img" data-fb="1" alt="">';
    html+='<div class="cart-item-info"><div class="cart-item-name">'+escapeHtml(item.name)+'</div>'+pill+'</div>';
    html+='<button class="cart-item-remove" data-cid="'+item.cartId+'" aria-label="นำ '+escapeHtml(item.name)+' ออกจากตะกร้า">&#x2715;</button>';
    html+='</div>';
    if(oe) html+='<div style="margin:0 0 10px;">'+oe+'</div>';
    html+='<div class="cart-item-bottom">';
    html+=(item.depositPrice>0
      ? '<label class="cart-deposit-toggle"><input type="checkbox" class="cdep" data-cid="'+item.cartId+'"'+(item.isDeposit?' checked':'')+'>  มัดจำ</label>'
      : '<span></span>');
    html+='<div class="cart-qty-stepper"><button class="cqb" data-cid="'+item.cartId+'" data-d="-1" aria-label="ลดจำนวน '+escapeHtml(item.name)+'">&#x2212;</button><span id="cqty-'+item.cartId+'">'+item.qty+'</span><button class="cqb" data-cid="'+item.cartId+'" data-d="1" aria-label="เพิ่มจำนวน '+escapeHtml(item.name)+'">&#x2B;</button></div>';
    html+='<div class="cart-item-price-block"><div class="cart-price-type '+ptc+'" id="ctype-'+item.cartId+'">'+ptl+'</div><div class="cart-item-price" id="cprice-'+item.cartId+'">'+formatCurrency(item.unitPrice*item.qty)+'</div></div>';
    html+='</div></div>';
  }
  list.innerHTML = html;
  list.onclick = function(e) {
    var rb = e.target.closest('.cart-item-remove'); if(rb){removeCartItem(parseInt(rb.getAttribute('data-cid'),10));return;}
    var qb = e.target.closest('.cqb'); if(qb){editCartQty(parseInt(qb.getAttribute('data-cid'),10),parseInt(qb.getAttribute('data-d'),10));return;}
  };
  list.onchange = function(e) {
    if(e.target.classList.contains('cart-option-edit')){editCartOption(parseInt(e.target.getAttribute('data-cid'),10),e.target.value);return;}
    if(e.target.classList.contains('cdep')){editCartDeposit(parseInt(e.target.getAttribute('data-cid'),10),e.target.checked);return;}
  };
  var imgs=list.querySelectorAll('img[data-fb]');
  for(var k=0;k<imgs.length;k++) imgs[k].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[k]);
  updateCartBadge();
}

function editCartQty(cid,d){
  var item=findCartItem(cid); if(!item) return;
  if(d>0){
    var prod=findProduct(item.productId);
    if(prod && prod.remaining!==Infinity && cartQtyOfProduct(item.productId)+1>prod.remaining){
      showMessage('สินค้ามีไม่พอค่ะ (เหลือ '+prod.remaining+' ชิ้น)','error');
      return;
    }
  }
  item.qty=Math.max(1,item.qty+d);
  var q=document.getElementById('cqty-'+cid), p=document.getElementById('cprice-'+cid);
  if(q) q.textContent=item.qty; if(p) p.textContent=formatCurrency(item.unitPrice*item.qty);
  updateCartBadge();
}
function editCartOption(cid,v){var item=findCartItem(cid);if(item)item.option=v;}
function editCartDeposit(cid,use){
  var item=findCartItem(cid); if(!item) return;
  if(use && !(Number(item.depositPrice)>0)){ renderCartSidebar(); return; }
  item.isDeposit=use; item.unitPrice=use?item.depositPrice:item.fullPrice;
  var p=document.getElementById('cprice-'+cid),t=document.getElementById('ctype-'+cid);
  if(p) p.textContent=formatCurrency(item.unitPrice*item.qty);
  if(t){t.textContent=use?'มัดจำ':'ราคาเต็ม';t.className='cart-price-type '+(use?'deposit':'full');}
  updateCartBadge();
}
function removeCartItem(cid){cart=cart.filter(function(i){return i.cartId!==cid;});renderCartSidebar();}

function clearCart() {
  var footer=document.querySelector('.cart-footer');
  if(document.getElementById('ccbar')) return;
  var bar=document.createElement('div'); bar.id='ccbar';
  bar.style.cssText='background:var(--warning-light);border:1.5px solid var(--warning);border-radius:var(--radius-sm);padding:8px 12px;margin-bottom:10px;font-size:0.83rem;display:flex;align-items:center;justify-content:space-between;gap:8px;';
  bar.innerHTML='<span>ล้างตะกร้าทั้งหมดใช่ไหม?</span><div style="display:flex;gap:6px;"><button id="ccyes" style="background:var(--error);color:#fff;padding:4px 12px;border-radius:8px;font-size:0.8rem;border:none;cursor:pointer;">ใช่</button><button id="ccno" style="background:var(--surface-2);color:var(--text-2);padding:4px 12px;border-radius:8px;font-size:0.8rem;border:1.5px solid var(--border);cursor:pointer;">ยกเลิก</button></div>';
  footer.prepend(bar);
  document.getElementById('ccyes').onclick=function(){cart=[];bar.remove();renderCartSidebar();};
  document.getElementById('ccno').onclick=function(){bar.remove();};
}

// The form explicitly asks customers to prefix their name with @ —
// enforce it so the instruction and the rule match.
function customerNameError(name){
  if(!name) return 'กรุณากรอกชื่อลูกค้าก่อนนะคะ';
  if(name.charAt(0)!=='@') return 'กรุณาใส่ @ นำหน้าชื่อ เช่น @yourname นะคะ';
  if(name.length<2) return 'กรุณากรอกชื่อหลังเครื่องหมาย @ ด้วยนะคะ';
  return null;
}

function checkoutFromCart() {
  if(!cart.length){showMessage('ตะกร้าว่างเปล่าค่ะ','error');return;}
  var name=(document.getElementById('customerName').value||'').trim();
  var nameErr=customerNameError(name);
  if(nameErr){closeCart();setTimeout(function(){showMessage(nameErr,'error');highlightInputError('customerName');},350);return;}
  var phone=(document.getElementById('customerPhone').value||'').trim();
  if(!phone){closeCart();setTimeout(function(){showMessage('กรุณากรอกเบอร์โทรก่อนนะคะ','error');highlightInputError('customerPhone');},350);return;}
  if(!isValidPhone(phone)){closeCart();setTimeout(function(){showMessage('เบอร์โทรไม่ถูกต้อง (06x/08x/09x 10 หลัก)','error');highlightInputError('customerPhone');},350);return;}
  closeCart();
  var total=0,hasDeposit=false,items=[];
  for(var i=0;i<cart.length;i++){
    var ci=cart[i],it=ci.unitPrice*ci.qty; total+=it; if(ci.isDeposit) hasDeposit=true;
    items.push({id:ci.productId,name:ci.name,image:ci.image,quantity:ci.qty,unitPrice:ci.unitPrice,fullPrice:ci.fullPrice,isDeposit:ci.isDeposit,total:it,selectedOption:ci.option||null});
  }
  summaryCache={customerName:name,customerPhone:phone,items:items,total:total,hasDeposit:hasDeposit};
  renderSummaryUI(summaryCache);
}

function setView(mode) {
  var t=document.getElementById('productTable');
  if(mode==='grid') t.classList.add('grid-mode'); else t.classList.remove('grid-mode');
  document.getElementById('listBtn').className='view-btn'+(mode==='list'?' active':'');
  document.getElementById('gridBtn').className='view-btn'+(mode==='grid'?' active':'');
}

function onProductsFetched(fetched) {
  products=[];
  for(var i=0;i<fetched.length;i++){
    if(fetched[i].status==='Open'){
      fetched[i].pendingOption=null; fetched[i].pendingDeposit=false;
      fetched[i].image=safeImg(fetched[i].image);
      if(fetched[i].remaining===undefined||fetched[i].remaining===null||fetched[i].remaining==='') fetched[i].remaining=Infinity;
      else fetched[i].remaining=Number(fetched[i].remaining);
      products.push(fetched[i]);
    }
  }
  activeTag='';
  populateProductTable();
  document.getElementById('loading').style.display='none';
  var form=document.getElementById('orderForm'); form.style.display='block'; form.classList.add('is-ready');
  addSearchListeners();
  renderGiftNudge(); // the baht amount needs this round's prices, which have only now arrived
}

function populateProductTable() {
  var tbody=document.querySelector('#productTable tbody'); tbody.innerHTML='';
  for(var pi=0;pi<products.length;pi++){
    var p=products[pi];
    var s2=sid(p.id);
    var opts=Array.isArray(p.options)?p.options.filter(function(o){return o&&String(o).trim();}):[];
    var optHtml='';
    if(opts.length>0){
      if(opts.length<5){
        var ch='';
        for(var oi=0;oi<opts.length;oi++) ch+='<button type="button" class="option-chip" aria-pressed="false" data-psid="'+s2+'" data-opt="'+escapeHtml(opts[oi])+'">'+escapeHtml(optLabel(opts[oi]))+'</button>';
        optHtml='<div class="options-wrapper"><div class="options-chips" id="popt-'+s2+'" role="group" aria-label="ตัวเลือกของ '+escapeHtml(p.name||'')+'">'+ch+'</div></div>';
      } else {
        var sel='<option value="">-- เลือกตัวเลือก --</option>';
        for(var oi2=0;oi2<opts.length;oi2++) sel+='<option value="'+escapeHtml(opts[oi2])+'">'+escapeHtml(optLabel(opts[oi2]))+'</option>';
        optHtml='<div class="options-wrapper"><select class="option-select" id="popt-'+s2+'" data-psid="'+s2+'" aria-label="เลือกตัวเลือกของ '+escapeHtml(p.name||'')+'">'+sel+'</select></div>';
      }
    }
    // Stock counts stay hidden from customers; only "sold out" shows (the
    // add-to-cart guard still enforces the real remaining amount)
    var soldOut = (p.remaining !== Infinity && p.remaining <= 0);
    var hasDep = Number(p.deposit) > 0;
    var row=tbody.insertRow();
    row.className = (soldOut ? 'sold-out' : '') + (hasDep ? '' : ' no-dep');
    row.innerHTML=
      '<td class="prod-img-cell"><img src="'+escapeHtml(thumbImg(p.image, 600))+'" alt="'+escapeHtml(p.name||'')+'" class="product-image" loading="lazy" width="50" height="50" data-fb="1">'+(soldOut?'<span class="sold-out-tag">หมดแล้ว</span>':'')+'</td>'+
      '<td class="prod-name-cell"><span class="prod-name">'+escapeHtml(p.name||'')+'</span>'+optHtml+'</td>'+
      '<td class="center-align prod-price-cell">'+formatCurrency(Number(p.price)||0)+'</td>'+
      '<td class="center-align prod-dep-cell">'+(hasDep
        ? '<button type="button" class="dep-toggle" aria-pressed="false" data-psid="'+s2+'"'+(soldOut?' disabled':'')+' aria-label="จ่ายมัดจำ '+shortPrice(p.deposit)+'">มัดจำ</button>'
        : '<span class="no-dep-dash">&#x2014;</span>')+'</td>'+
      '<td class="prod-action-cell"><button class="add-to-cart-btn atcbtn" data-psid="'+s2+'"'+(soldOut?' disabled':'')+' aria-label="ซื้อเลย '+escapeHtml(p.name||'')+' ราคา '+shortPrice(p.price)+'">'+(soldOut?'หมดแล้ว':buyLabel(p.price))+'</button></td>';
  }
  var tbl=document.getElementById('productTable');
  tbl.onclick=function(e){
    var chip=e.target.closest('.option-chip');
    if(chip){selectChip(chip.getAttribute('data-psid'),chip.getAttribute('data-opt'),chip);return;}
    var dt=e.target.closest('.dep-toggle');
    if(dt){var dp=findProductBySid(dt.getAttribute('data-psid'));if(dp)setPendingDep(dt.getAttribute('data-psid'),!dp.pendingDeposit);return;}
    var ab=e.target.closest('.atcbtn');
    if(ab){addToCartBySid(ab.getAttribute('data-psid'));return;}
  };
  tbl.onchange=function(e){
    if(e.target.classList.contains('option-select')){setPendingOpt(e.target.getAttribute('data-psid'),e.target.value);return;}
  };
  var imgs=tbody.querySelectorAll('img[data-fb]');
  for(var i=0;i<imgs.length;i++) imgs[i].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[i]);
  applyProductTags();
}

// ── Tag filter: chips of the characters and item types in this list (js/tags.js).
// Tags are read from each product's name and options with the shop's dictionary;
// without the dictionary the page works as before, with no chips. ──
var tagMatcher=null, activeTag='';
function loadTagTerms(){
  if(!window.Tags) return;
  google.script.run.withSuccessHandler(function(r){
    try{var res=JSON.parse(r);if(res.status==='Success'&&res.terms&&res.terms.length){tagMatcher=Tags.compile(res.terms);applyProductTags();}}catch(e){}
  }).getTagTerms();
}
function applyProductTags(){
  var bar=document.getElementById('tagFilter');
  if(!bar) return;
  var rows=document.querySelectorAll('#productTable tbody tr');
  if(!tagMatcher||!rows.length||rows.length!==products.length){bar.hidden=true;bar.innerHTML='';return;}
  var meta=getOrderListMetaBySheetId(selectedSheetId), ctx=meta&&meta.name?meta.name:'', count={}, kinds=['char','type'];
  for(var i=0;i<products.length;i++){
    var p=products[i], opts=Array.isArray(p.options)?p.options.map(optLabel).join(' '):'';
    var t=Tags.tagsOfItem((p.name||'')+' '+opts, ctx, tagMatcher), keys=[];
    for(var k=0;k<kinds.length;k++){var arr=t[kinds[k]]||[];for(var a=0;a<arr.length;a++){var key=kinds[k]+':'+arr[a];keys.push(key);count[key]=(count[key]||0)+1;}}
    rows[i].setAttribute('data-tags','|'+keys.join('|')+'|');
    rows[i].setAttribute('data-words',Tags.words(t,tagMatcher));
  }
  // A tag every product has filters nothing, so it gets no chip
  var chips=Object.keys(count).filter(function(c){return count[c]<products.length;}).sort(function(x,y){
    var kx=x.indexOf('char:')===0?0:1, ky=y.indexOf('char:')===0?0:1;
    return kx-ky||count[y]-count[x];
  }).slice(0,30);
  if(chips.indexOf(activeTag)===-1) activeTag='';
  bar.innerHTML='';
  if(chips.length<2){bar.hidden=true;filterProducts();return;}
  function chip(key,label,n){
    var b=document.createElement('button');b.type='button';b.className='tag-filter-chip';
    b.setAttribute('aria-pressed',activeTag===key?'true':'false');b.textContent=label;
    if(n){var s=document.createElement('small');s.textContent=n;b.appendChild(s);}
    b.onclick=function(){activeTag=activeTag===key?'':key;applyProductTags();};
    bar.appendChild(b);
  }
  chip('','ทั้งหมด',0);
  for(var c=0;c<chips.length;c++) chip(chips[c],chips[c].slice(chips[c].indexOf(':')+1),count[chips[c]]);
  bar.hidden=false;
  filterProducts();
}

function selectChip(s2,opt,el){
  var p=findProductBySid(s2); if(!p) return;
  if(p.pendingOption===opt){p.pendingOption=null;el.classList.remove('selected');el.setAttribute('aria-pressed','false');}
  else{
    p.pendingOption=opt;
    var c=document.getElementById('popt-'+s2);
    if(c){var chips=c.querySelectorAll('.option-chip');for(var i=0;i<chips.length;i++){chips[i].classList.remove('selected');chips[i].setAttribute('aria-pressed','false');}}
    el.classList.add('selected');el.setAttribute('aria-pressed','true');
  }
}
function setPendingOpt(s2,v){var p=findProductBySid(s2);if(p)p.pendingOption=v||null;}
// Deposit toggle: pressed → the add button charges the deposit instead of the full price
function setPendingDep(s2,v){
  var p=findProductBySid(s2); if(!p) return;
  p.pendingDeposit=!!v;
  if(Number(p.deposit)>0){
    var mine=cart.filter(function(i){return i.productId===p.id;});
    if(mine.some(function(i){return i.isDeposit!==p.pendingDeposit;})){
      mine.forEach(function(i){i.isDeposit=p.pendingDeposit;i.unitPrice=i.isDeposit?i.depositPrice:i.fullPrice;});
      // Two lines that now match (same option, same price type) become one
      cart=cart.filter(function(i){
        if(i.productId!==p.id) return true;
        var first=mine.filter(function(m){return m.option===i.option;})[0];
        if(first===i) return true;
        first.qty+=i.qty; return false;
      });
      updateCartBadge();
      showMessage(p.pendingDeposit?'เปลี่ยนสินค้าในตะกร้าเป็นมัดจำแล้วค่ะ':'เปลี่ยนสินค้าในตะกร้าเป็นราคาเต็มแล้วค่ะ','success');
    }
  }
  var row=document.querySelector('#productTable .atcbtn[data-psid="'+s2+'"]'); row=row&&row.closest('tr'); if(!row) return;
  var t=row.querySelector('.dep-toggle'); if(t){t.setAttribute('aria-pressed',p.pendingDeposit?'true':'false');t.classList.toggle('on',p.pendingDeposit);}
  var b=row.querySelector('.atcbtn');
  if(b&&!b.disabled){var price=p.pendingDeposit?p.deposit:p.price;b.innerHTML=buyLabel(price);b.setAttribute('aria-label','ซื้อเลย '+(p.name||'')+' ราคา '+shortPrice(price)+(p.pendingDeposit?' (มัดจำ)':''));}
}
// "฿120" / "฿1,250.50" — compact price for card buttons
function shortPrice(n){return '฿'+(Number(n)||0).toLocaleString('th-TH',{maximumFractionDigits:2});}
// Two-line buy button: small "ซื้อเลย" over the price being charged
function buyLabel(n){return '<span class="buy-label">ซื้อเลย</span><span class="buy-price">'+shortPrice(n)+'</span>';}

function setFabVisible(v){document.getElementById('bottomBar').style.display=v?'flex':'none';}

function renderSummaryUI(cache) {
  var tq=0; for(var i=0;i<cache.items.length;i++) tq+=cache.items[i].quantity;
  var m='<div class="summary-meta-chip">&#x1F464; '+escapeHtml(cache.customerName)+'</div>';
  if(cache.customerPhone) m+='<div class="summary-meta-chip">&#x1F4DE; '+escapeHtml(cache.customerPhone)+'</div>';
  m+='<div class="summary-meta-chip">&#x1F4E6; '+tq+' ชิ้น</div>';
  if(cache.hasDeposit) m+='<div class="summary-meta-chip accent">&#x1F4B0; มีรายการมัดจำ</div>';
  document.getElementById('summaryMeta').innerHTML=m;
  var html='<ul style="list-style:none;padding:0;margin:0;">';
  for(var j=0;j<cache.items.length;j++){var it=cache.items[j];html+=buildItemHtml(it.image,it.name,it.selectedOption,it.quantity,it.unitPrice,it.total,it.isDeposit,it.fullPrice*it.quantity);}
  html+='</ul>';
  // Gifts this order should earn (the server confirms on submit)
  var gs=giftStatus(cache.items);
  if(gs&&gs.winners.length){
    html+='<div class="gift-earned"><div class="gift-title">ของแถมที่จะได้รับ</div>';
    gs.winners.forEach(function(w){html+='<div class="gift-earned-item">'+escapeHtml(w.label)+'</div>';});
    html+='</div>';
  }
  document.getElementById('summaryContent').innerHTML=html;
  document.getElementById('totalPrice').textContent=cache.hasDeposit?formatCurrency(cache.total)+' (มัดจำ)':formatCurrency(cache.total);
  var form=document.getElementById('orderForm'); form.style.display='none'; form.classList.remove('is-ready');
  document.getElementById('summary').style.display='flex'; setFabVisible(false); document.body.classList.add('on-summary');
}

function editOrder(){
  summaryCache=null;
  var form=document.getElementById('orderForm'); form.style.display='block'; form.classList.add('is-ready');
  document.getElementById('summary').style.display='none'; setFabVisible(true); document.body.classList.remove('on-summary');
}

function confirmOrder(){
  if(isSubmitted) return;
  if(!summaryCache||!summaryCache.items.length){showMessage('ไม่มีข้อมูลสรุปคำสั่งซื้อ','error');return;}
  isSubmitted=true;
  var btn=document.getElementById('confirmButton'); btn.disabled=true; btn.textContent='กำลังยืนยัน...';
  currentOrder=summaryCache;
  // Reuse the same checkout id across retries of this same summary,
  // so a network hiccup + retry can never create a duplicate order
  summaryCache.checkoutId = summaryCache.checkoutId || (window.__newCheckoutId ? window.__newCheckoutId() : null);
  var oi=[];
  for(var i=0;i<summaryCache.items.length;i++){var it=summaryCache.items[i];oi.push({id:it.id,quantity:it.quantity,isDeposit:it.isDeposit,selectedOption:it.selectedOption||null});}
  google.script.run.withSuccessHandler(handleSubmitOk).withFailureHandler(handleSubmitFail)
    .submitOrderToSheet(selectedSheetId,summaryCache.customerName,summaryCache.customerPhone||'',oi,summaryCache.checkoutId);
}

function onOrderSuccess(gifted){
  resetSubmitState();
  document.getElementById('mainContent').style.display='none';
  document.getElementById('summary').style.display='none';
  document.getElementById('confirmation').style.display='block';
  setFabVisible(false);
  var pr=currentOrder.customerPhone?'<p style="margin:2px 0 10px;font-size:0.88rem;color:var(--text-2);"><strong>เบอร์โทร:</strong> '+escapeHtml(currentOrder.customerPhone)+'</p>':'';
  var html='<p style="margin:0 0 2px;font-weight:700;font-size:0.95rem;">'+escapeHtml(currentOrder.customerName)+'</p>'+pr+'<ul style="list-style:none;padding:0;margin:0;">';
  var total=0,hasDeposit=false;
  for(var i=0;i<currentOrder.items.length;i++){
    var item=currentOrder.items[i], p=findProduct(item.id); if(!p) continue;
    var up=item.isDeposit?Number(p.deposit):Number(p.price), it=up*item.quantity;
    if(item.isDeposit) hasDeposit=true;
    html+=buildItemHtml(p.image,p.name,item.selectedOption,item.quantity,up,it,item.isDeposit,p.price*item.quantity);
    total+=Number(it)||0;
  }
  html+='</ul>';
  // Gifts the server actually gave (a retried duplicate reports none — fall back to the preview)
  var gifts=Array.isArray(gifted)?gifted:((giftStatus(currentOrder.items)||{winners:[]}).winners.map(function(w){return w.label;}));
  if(gifts.length){
    html+='<div class="gift-earned"><div class="gift-title">ของแถมที่ได้รับ</div>';
    gifts.forEach(function(n){html+='<div class="gift-earned-item">'+escapeHtml(n)+'</div>';});
    html+='</div>';
  }
  document.getElementById('orderSummary').innerHTML=html;
  document.getElementById('orderTotal').textContent=(hasDeposit?'ยอดรวมทั้งสิ้น: '+formatCurrency(total)+' (มัดจำ)':'ยอดรวมทั้งสิ้น: '+formatCurrency(total));
  showMessage('ยืนยันคำสั่งซื้อเรียบร้อยแล้ว','success');
  setTimeout(downloadReceipt,1500);
}

function buildItemHtml(img,name,option,qty,up,total,isDeposit,fullPrice){
  var hint=isDeposit?'<div class="receipt-item-hint">ราคาเต็ม: '+formatCurrency(fullPrice)+'</div>':'';
  var opt=option?'<div class="receipt-item-option">'+escapeHtml(optLabel(option))+'</div>':'';
  return '<li class="receipt-item"><img src="'+escapeHtml(thumbImg(img, 160))+'" class="receipt-item-img" data-fb="1"><div class="receipt-item-body"><div class="receipt-item-name">'+escapeHtml(name)+'</div>'+opt+'<div class="receipt-item-price">'+escapeHtml(qty)+' x '+formatCurrency(up)+' = <strong>'+formatCurrency(total)+'</strong></div>'+hint+'</div></li>';
}

// Guard against silently throwing away a filled cart when navigating
// back to the hub or switching lists. Returns true when it's OK to go.
function confirmDiscardCart(){
  if(!cart.length) return true;
  return confirm('ตะกร้ามีสินค้า '+cartCount()+' ชิ้น หากออกจากหน้านี้ตะกร้าจะถูกล้าง\nต้องการออกใช่ไหมคะ?');
}

function resetForm(){
  document.body.classList.remove('on-summary');
  cart=[];updateCartBadge();
  var s=document.getElementById('productSearch');if(s)s.value='';
  for(var i=0;i<products.length;i++){products[i].pendingOption=null;products[i].pendingDeposit=false;}
  selectedSheetId=null;
  document.getElementById('orderContainer').style.display='none';
  document.getElementById('hubContainer').style.display='';
  document.getElementById('bottomBar').style.display='none';
  document.getElementById('mainContent').style.display='';
  document.getElementById('orderForm').style.display='none';
  document.getElementById('loading').style.display='flex';
  document.getElementById('summary').style.display='none';
  document.getElementById('confirmation').style.display='none';
  summaryCache=null;currentOrder=null;resetSubmitState();loadHubPage();
}

function handleSubmitOk(r){var res=JSON.parse(r);if(res.status==='Success'){onOrderSuccess(res.duplicate?null:(res.gifts||null));refreshListGifts();loadGiftBase();}else{resetSubmitState();showMessage(res.message,'error');}}
// Gift stock changes with every order — reload the list rules quietly
function refreshListGifts(){google.script.run.withSuccessHandler(function(lists){if(Array.isArray(lists))hubOrderLists=lists;}).getOrderLists();}
function handleSubmitFail(e){resetSubmitState();showMessage('เกิดข้อผิดพลาดในการส่งคำสั่งซื้อ','error');console.error(e);}
function resetSubmitState(){
  isSubmitted=false;
  var btn=document.getElementById('confirmButton');
  if(btn){btn.disabled=false;btn.textContent='ยืนยันและส่งคำสั่งซื้อ \u2192';}
}

// iPhone/iPad and in-app browsers ignore <a download>
function canDownloadFiles() {
  var ua = navigator.userAgent || '';
  var ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return !ios && !/Line\/|FBAN|FBAV|FB_IAB|Instagram|TikTok/i.test(ua);
}
// Full-screen receipt: long press the picture to save it, or use the share sheet
function showReceiptViewer(dataUrl) {
  var old = document.getElementById('rcptView'); if (old) old.remove();
  var v = document.createElement('div'); v.id = 'rcptView'; v.className = 'rcpt-view';
  v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'ใบยืนยันคำสั่งซื้อ');
  var tip = document.createElement('div'); tip.className = 'rcpt-view-tip';
  tip.innerHTML = '&#x1F447; <b>แตะค้างที่รูป</b> แล้วเลือก <b>&ldquo;บันทึกลงในรูปภาพ&rdquo;</b>';
  var img = document.createElement('img'); img.src = dataUrl; img.alt = 'ใบยืนยันคำสั่งซื้อ';
  var btns = document.createElement('div'); btns.className = 'rcpt-view-btns';
  var file = null;
  try {
    var bin = atob(dataUrl.split(',')[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    file = new File([arr], 'receipt_' + Date.now() + '.png', { type: 'image/png' });
  } catch (e) { file = null; }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    var share = document.createElement('button'); share.type = 'button'; share.className = 'rcpt-share';
    share.textContent = 'บันทึก / แชร์รูป';
    share.onclick = function() { navigator.share({ files: [file] }).catch(function() {}); };
    btns.appendChild(share);
  }
  var close = document.createElement('button'); close.type = 'button'; close.className = 'rcpt-close'; close.textContent = 'ปิด';
  close.onclick = function() { v.remove(); };
  btns.appendChild(close);
  v.appendChild(tip); v.appendChild(img); v.appendChild(btns);
  document.body.appendChild(v);
}

function downloadReceipt() {
  var receipt = document.getElementById('receipt');
  var list    = document.querySelector('#orderSummary ul');
  var btn     = document.getElementById('downloadBtn');

  if (typeof window.html2canvas !== 'function') {
    btn.disabled = true;
    btn.textContent = '⏳ กำลังโหลดเครื่องมือสร้างรูป...';
    ensureHtml2Canvas().then(downloadReceipt).catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'ดาวน์โหลดใบยืนยันคำสั่งซื้อ';
      showMessage('ไม่สามารถโหลดเครื่องมือสร้างใบยืนยันคำสั่งซื้อได้', 'error');
      console.error(err);
    });
    return;
  }
 
  // Show generating state but keep button visible always
  btn.disabled = true;
  btn.textContent = '⏳ กำลังสร้างรูป...';
 
  // Expand list fully so html2canvas captures everything
  var om = list ? list.style.maxHeight  : null;
  var oo = list ? list.style.overflowY  : null;
  if (list) { list.style.maxHeight = 'none'; list.style.overflowY = 'visible'; }
 
  // ── Step 1: proxy all external <img> through Apps Script so
  //    html2canvas can read pixel data (avoids CORS/tainted-canvas)
  var imgs = receipt.querySelectorAll('img');
  var pending = imgs.length;
 
  function afterImagesProxied() {
    html2canvas(receipt, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      windowHeight: receipt.scrollHeight + 200
    })
    .then(function(canvas) {
      // Restore list styles
      if (list) { list.style.maxHeight = om; list.style.overflowY = oo; }
 
      var dataUrl = canvas.toDataURL('image/png');
 
      // ── Step 2: download where the browser can (Android/desktop); iPhone, iPad
      //    and in-app browsers (LINE, Facebook…) can't, so they get the image
      //    full screen to save with a long press or the share sheet
      if (canDownloadFiles()) {
        try {
          var a = document.createElement('a');
          a.download = 'receipt_' + Date.now() + '.png';
          a.href = dataUrl;
          a.click();
        } catch(e) {}
      } else {
        showReceiptViewer(dataUrl);
      }
 
      // ── Step 3: Insert inline preview image below receipt ──
      //    On iOS the <a>.click() download doesn't work, so we show
      //    the image so the user can long-press → Save to Photos
      var previewWrap = document.getElementById('receiptImgPreview');
      if (!previewWrap) {
        previewWrap = document.createElement('div');
        previewWrap.id = 'receiptImgPreview';
        previewWrap.style.cssText = [
          'margin-top:16px;border-radius:12px;overflow:hidden;',
          'box-shadow:0 4px 20px rgba(0,0,0,0.12);'
        ].join('');
        receipt.parentNode.insertBefore(previewWrap, receipt.nextSibling);
      }
 
      var hint = document.createElement('p');
      hint.style.cssText = 'text-align:center;font-size:0.78rem;color:var(--text-3);margin:10px 0 6px;';
      hint.innerHTML = '<strong>หากรูปภาพไม่โหลดเอง:</strong> กดค้างที่รูปด้านล่าง → บันทึกรูปภาพ';
 
      var preview = document.createElement('img');
      preview.src = dataUrl;
      preview.style.cssText = 'width:100%;display:block;-webkit-touch-callout:default;';
      preview.alt = 'ใบยืนยันคำสั่งซื้อ';
 
      previewWrap.innerHTML = '';
      previewWrap.appendChild(hint);
      previewWrap.appendChild(preview);
 
      // Restore button
      btn.disabled = false;
      btn.textContent = '⬇ ดาวน์โหลดใบยืนยันคำสั่งซื้อ';
    })
    .catch(function(err) {
      console.error('html2canvas error:', err);
      showMessage('สร้างรูปไม่สำเร็จ กรุณาแคปหน้าจอแทนนะคะ', 'error');
      if (list) { list.style.maxHeight = om; list.style.overflowY = oo; }
      btn.disabled = false;
      btn.textContent = '⬇ ดาวน์โหลดใบยืนยันคำสั่งซื้อ';
    });
  }
 
  // ── Proxy images: replace src with base64 via Apps Script fetch ──
  // This avoids CORS issues with externally hosted product images.
  if (pending === 0) {
    afterImagesProxied();
    return;
  }
 
  imgs.forEach(function(img) {
    var original = img.getAttribute('data-original-src') || img.src;
 
    // Skip data URLs (already local) and SVG placeholders
    if (!original || original.indexOf('data:') === 0 || original.indexOf('blob:') === 0) {
      pending--;
      if (pending === 0) afterImagesProxied();
      return;
    }
 
    // Store original so re-clicks don't re-proxy
    img.setAttribute('data-original-src', original);
 
    google.script.run
      .withSuccessHandler(function(b64) {
        if (b64) {
          img.src = 'data:image/png;base64,' + b64;
        }
        pending--;
        if (pending === 0) afterImagesProxied();
      })
      .withFailureHandler(function() {
        pending--;
        if (pending === 0) afterImagesProxied();
      })
      .proxyImageAsBase64(original);
  });
}

function filterProducts(){
  // Matches the name or any spelling of the product's tags, within the chosen chip
  var t=document.getElementById('productSearch').value.toLowerCase().trim();
  var rows=document.querySelectorAll('#productTable tbody tr');
  for(var i=0;i<rows.length;i++){
    var nameEl=rows[i].querySelector('.prod-name')||rows[i].querySelector('td:nth-child(2)');
    var text=(nameEl?nameEl.textContent.toLowerCase():'')+' '+(rows[i].getAttribute('data-words')||'');
    var inTag=!activeTag||(rows[i].getAttribute('data-tags')||'').indexOf('|'+activeTag+'|')!==-1;
    rows[i].style.display=(inTag&&text.indexOf(t)!==-1)?'':'none';
  }
}
function addSearchListeners(){
  var inp=document.getElementById('productSearch'),btn=document.getElementById('clearSearch');
  if(inp) inp.oninput=filterProducts;
  if(btn) btn.onclick=function(e){e.preventDefault();inp.value='';inp.focus();filterProducts();};
}

function filterHubCards(t){
  t=(t||'').toLowerCase();
  var cards=document.querySelectorAll('#hubGrid .hub-card');
  for(var i=0;i<cards.length;i++){var n=cards[i].querySelector('.hub-card-name');cards[i].style.display=(n&&n.textContent.toLowerCase().indexOf(t)!==-1)?'':'none';}
}

function loadHubPage(){
  google.script.run.withSuccessHandler(renderHubCards).withFailureHandler(function(){document.getElementById('hubSubtitle').textContent='เกิดข้อผิดพลาดในการโหลดค่ะ';}).getOrderLists();
}

function renderHubCards(lists){
  hubOrderLists=lists;
  var grid=document.getElementById('hubGrid'),sub=document.getElementById('hubSubtitle');
  var open=0; for(var i=0;i<lists.length;i++) if(lists[i].status==='Open') open++;
  sub.textContent='มีรายการสั่งซื้อ '+open+' รายการที่เปิดรับอยู่ค่ะ';
  if(!lists.length){grid.innerHTML='<div style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:40px;">ยังไม่มีรายการสั่งซื้อค่ะ</div>';return;}
  lists=lists.slice().sort(function(a,b){var ao=a.status==='Open'?0:1,bo=b.status==='Open'?0:1;return ao-bo;});
  var html='';
  for(var j=0;j<lists.length;j++){
    var item=lists[j],isOpen=(item.status==='Open');
    var badge=isOpen?'<span class="hub-status-open">&#x25CF; เปิดรับอยู่</span>':'<span class="hub-status-closed">&#x2715; ปิดรับแล้ว</span>';
    var arrow=isOpen?'<span class="hub-card-arrow">&#x2192;</span>':'';
    // role=button + tabindex makes the cards reachable and activatable
    // by keyboard while keeping the existing card markup/design
    var a11y=isOpen?' role="button" tabindex="0" aria-label="เลือกรายการ '+escapeHtml(item.name)+'"':' aria-disabled="true"';
    html+='<div class="hub-card'+(isOpen?'':' closed')+'" data-shid="'+escapeHtml(item.sheetId)+'"'+a11y+'>';
    html+='<div class="hub-card-img-wrap"><img src="'+escapeHtml(thumbImg(item.image, 600))+'" class="hub-card-img" loading="lazy" data-fb="1" alt=""></div>';
    html+='<div class="hub-card-body"><div class="hub-card-name">'+escapeHtml(item.name)+'</div>';
    html+='<div class="hub-card-desc">'+escapeHtml(item.description||(isOpen?'คลิกเพื่อสั่งซื้อ':'ปิดรับออเดอร์แล้วค่ะ'))+'</div>';
    html+='<div class="hub-card-footer">'+badge+arrow+'</div></div></div>';
  }
  grid.innerHTML=html;
  // A closed round says so (and where to check orders) instead of doing nothing
  function closedNote(){showMessage('รอบนี้ปิดรับออเดอร์แล้วค่ะ — ดูสถานะคำสั่งซื้อได้ที่ "เช็คสถานะ / แจ้งโอน"','error');}
  grid.onclick=function(e){var c=e.target.closest('.hub-card');if(!c)return;if(c.classList.contains('closed'))closedNote();else selectOrderList(c.getAttribute('data-shid'));};
  grid.onkeydown=function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;
    var c=e.target.closest('.hub-card');
    if(c&&!c.classList.contains('closed')){e.preventDefault();selectOrderList(c.getAttribute('data-shid'));}
  };
  var imgs=grid.querySelectorAll('img[data-fb]');
  for(var k=0;k<imgs.length;k++) imgs[k].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[k]);
}

function selectOrderList(sheetId){
  if(!sheetId) return;
  var name=(document.getElementById('customerName').value||'').trim();
  var nameErr=customerNameError(name);
  var phone=(document.getElementById('customerPhone').value||'').trim();
  if(!name&&!phone){showMessage('กรุณากรอกชื่อลูกค้าและเบอร์โทรก่อนนะคะ','error');highlightInputError('customerPhone');highlightInputError('customerName');return;}
  if(nameErr){showMessage(nameErr,'error');highlightInputError('customerName');return;}
  if(!phone){showMessage('กรุณากรอกเบอร์โทรก่อนเลือกรายการสั่งซื้อนะคะ','error');highlightInputError('customerPhone');return;}
  if(!isValidPhone(phone)){showMessage('เบอร์โทรไม่ถูกต้อง (06x/08x/09x 10 หลัก)','error');highlightInputError('customerPhone');return;}
  // Remember validated details so returning customers skip retyping
  try{localStorage.setItem('_custName',name);localStorage.setItem('_custPhone',phone);}catch(e){}
  selectedSheetId=sheetId;
  var unames=document.querySelectorAll('.js-username'); for(var u=0;u<unames.length;u++) unames[u].textContent=name;
  document.getElementById('hubContainer').style.display='none';
  document.getElementById('orderContainer').style.display='';
  document.getElementById('bottomBar').style.display='flex';
  document.getElementById('loading').style.display='flex';
  document.getElementById('orderForm').style.display='none';
  google.script.run
    .withSuccessHandler(function(r){try{var res=JSON.parse(r);if(res.status!=='Success'){document.getElementById('loading').textContent='เกิดข้อผิดพลาด: '+res.message;return;}onProductsFetched(res.products);}catch(ex){document.getElementById('loading').textContent='เกิดข้อผิดพลาดในการโหลดสินค้า';}})
    .withFailureHandler(function(){document.getElementById('loading').textContent='ไม่สามารถโหลดสินค้าได้ค่ะ';})
    .getProductsFromSheet(sheetId);
  setWorkbookNameBySheetId(sheetId);
  loadGiftBase();
}

function openSideMenu(){document.getElementById('sideMenu').classList.add('open');document.getElementById('sideMenuOverlay').classList.add('open');renderSideMenuList();}
function closeSideMenu(){document.getElementById('sideMenu').classList.remove('open');document.getElementById('sideMenuOverlay').classList.remove('open');}

function renderSideMenuList(){
  var list=document.getElementById('sideMenuList');
  if(!hubOrderLists.length){
    list.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-3);font-size:0.85rem;">กำลังโหลด...</div>';
    google.script.run.withSuccessHandler(function(ls){hubOrderLists=ls;buildSideMenuItems();}).getOrderLists();
    return;
  }
  buildSideMenuItems();
}

function buildSideMenuItems(){
  var list=document.getElementById('sideMenuList'),html='';
  var items=hubOrderLists.slice().sort(function(a,b){
    var ao=a.status==='Open'?0:1;
    var bo=b.status==='Open'?0:1;
    return ao-bo;
  });

  for(var i=0;i<items.length;i++){
    var item=items[i],isOpen=(item.status==='Open'),isCurrent=(item.sheetId===selectedSheetId);
    var st=isCurrent?'<div class="sms-open">&#x25CF; กำลังดูอยู่</div>':(isOpen?'<div class="sms-open">&#x25CF; เปิดรับอยู่</div>':'<div class="sms-closed">&#x2715; ปิดรับแล้ว</div>');
    var dis=!isOpen?'style="opacity:0.5;cursor:not-allowed;"':'';
    html+='<button class="side-menu-item'+(isCurrent?' active':'')+'" data-shid="'+escapeHtml(item.sheetId)+'" data-open="'+(isOpen?'1':'0')+'" data-cur="'+(isCurrent?'1':'0')+'" '+dis+'>';
    html+='<img src="'+escapeHtml(thumbImg(item.image, 120))+'" class="side-menu-item-img" loading="lazy" data-fb="1">';
    html+='<div><div class="side-menu-item-name">'+escapeHtml(item.name)+'</div>'+st+'</div></button>';
  }

  list.innerHTML=html;
  list.onclick=function(e){
    var b=e.target.closest('.side-menu-item');
    if(b&&b.getAttribute('data-open')==='1'&&b.getAttribute('data-cur')==='0'){
      switchOrderList(b.getAttribute('data-shid'));
    }
  };

  var imgs=list.querySelectorAll('img[data-fb]');
  for(var k=0;k<imgs.length;k++) imgs[k].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[k]);
}

function switchOrderList(sheetId){
  if(!confirmDiscardCart()) return;
  closeSideMenu(); cart=[];updateCartBadge(); document.body.classList.remove('on-summary');
  var s=document.getElementById('productSearch');if(s)s.value='';
  summaryCache=null;currentOrder=null;
  document.getElementById('orderForm').style.display='none';
  document.getElementById('orderForm').classList.remove('is-ready');
  document.getElementById('loading').style.display='flex';
  document.getElementById('summary').style.display='none';
  document.getElementById('confirmation').style.display='none';
  var tb=document.querySelector('#productTable tbody');if(tb)tb.innerHTML='';
  setFabVisible(true); selectedSheetId=sheetId;
  google.script.run.withSuccessHandler(function(r){try{var res=JSON.parse(r);if(res.status==='Success')onProductsFetched(res.products);}catch(ex){}}).getProductsFromSheet(sheetId);
  setWorkbookNameBySheetId(sheetId);
  loadGiftBase();
}

// Static event bindings
document.getElementById('cartOverlay').onclick = closeCart;
document.getElementById('cartCloseBtn').onclick = closeCart;
document.getElementById('cartClearBtn').onclick = clearCart;
document.getElementById('checkoutBtn').onclick = checkoutFromCart;
document.getElementById('cartBarBtn').onclick = openCart;
document.getElementById('menuToggleBtn').onclick = openSideMenu;
// Swipes: right opens the list menu (left side), left closes it; the cart
// (right side) closes with a swipe right. Sideways scrollers keep their swipe.
(function() {
  var s = null;
  function scrollsSideways(n) {
    for (; n && n !== document.body; n = n.parentNode) {
      if (n.nodeType === 1 && n.scrollWidth > n.clientWidth + 4 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
    }
    return false;
  }
  function isOpen(id) { return document.getElementById(id).classList.contains('open'); }
  document.addEventListener('touchstart', function(e) {
    s = null;
    if (e.touches.length !== 1 || document.getElementById('rcptView')) return;
    var t = e.touches[0], menu = isOpen('sideMenu'), cartOpen = isOpen('cartSidebar');
    if (!menu && !cartOpen && t.clientX > 32 && (scrollsSideways(e.target) || e.target.closest('input,textarea,select'))) return;
    s = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    if (!s) return;
    var t = e.changedTouches[0], dx = t.clientX - s.x, dy = t.clientY - s.y, quick = Date.now() - s.at < 600;
    s = null;
    if (!quick || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (isOpen('cartSidebar')) { if (dx > 0) closeCart(); return; }
    if (isOpen('sideMenu')) { if (dx < 0) closeSideMenu(); return; }
    // The list menu only exists on the product page
    var onShop = selectedSheetId && document.getElementById('orderContainer').style.display !== 'none' && document.getElementById('orderForm').style.display !== 'none';
    if (dx > 0 && onShop) openSideMenu();
  }, { passive: true });
})();

document.getElementById('sideMenuOverlay').onclick = closeSideMenu;
document.getElementById('sideMenuCloseBtn').onclick = closeSideMenu;
document.getElementById('sideMenuBackBtn').onclick = function(){
  if(!confirmDiscardCart()) return;
  closeSideMenu();resetForm();
};
document.getElementById('listBtn').onclick = function(){setView('list');};
document.getElementById('gridBtn').onclick = function(){setView('grid');};
document.getElementById('editOrderBtn').onclick = editOrder;
document.getElementById('confirmButton').onclick = confirmOrder;
document.getElementById('downloadBtn').onclick = downloadReceipt;
document.getElementById('newOrderBtn').onclick = resetForm;
loadTagTerms();
document.getElementById('hubSearch').oninput = function(){filterHubCards(this.value);};
document.getElementById('hubSearchClear').onclick = function(){document.getElementById('hubSearch').value='';filterHubCards('');};
document.getElementById('customerName').onkeydown = function(e){if(e.key==='Enter')e.preventDefault();};
document.getElementById('customerPhone').onkeydown = function(e){if(e.key==='Enter')e.preventDefault();};
window.addEventListener('beforeunload',function(e){if(currentOrder&&!isSubmitted){e.preventDefault();e.returnValue='';}});

// Prefill remembered customer details for returning customers
try{
  var _savedCustName=localStorage.getItem('_custName'), _savedCustPhone=localStorage.getItem('_custPhone');
  if(_savedCustName) document.getElementById('customerName').value=_savedCustName;
  if(_savedCustPhone) document.getElementById('customerPhone').value=_savedCustPhone;
}catch(e){}

document.getElementById('bottomBar').style.display='none';
loadHubPage();
updateCartBadge();
setView('grid');
