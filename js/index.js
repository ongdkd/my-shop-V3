var PLACEHOLDER = 'https://www.svgrepo.com/show/508699/landscape-placeholder.svg';
var products = [], cart = [], cartIdSeq = 0;
var currentOrder = null, isSubmitted = false, summaryCache = null;
var selectedSheetId = null, hubOrderLists = [];

function isValidPhone(p) { return /^0[6-9]\d{8}$/.test(p.replace(/[-\s]/g,'')); }

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
  el.innerHTML = text; el.className = 'message ' + type; el.style.display = 'block';
  setTimeout(function(){el.style.display='none';}, 4000);
}

function formatCurrency(n) { return new Intl.NumberFormat('th-TH',{style:'currency',currency:'THB'}).format(n); }
function safeImg(u) { return (u && u !== '') ? u : PLACEHOLDER; }
function sid(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g,'_'); }

function cartTotal() { var s=0; for(var i=0;i<cart.length;i++) s+=cart[i].unitPrice*cart[i].qty; return s; }
function cartCount() { var s=0; for(var i=0;i<cart.length;i++) s+=cart[i].qty; return s; }

function updateCartBadge() {
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
  var isDeposit = !!product.pendingDeposit;
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
  showMessage('เพิ่ม "' + product.name + (option?' ('+option+')':'') + '" ลงตะกร้าแล้ว', 'success');
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
      oe='<select class="cart-option-edit" data-cid="'+item.cartId+'">';
      for(var j=0;j<item.options.length;j++) oe+='<option value="'+item.options[j]+'"'+(item.options[j]===item.option?' selected':'')+'>'+item.options[j]+'</option>';
      oe+='</select>';
    }
    var pill = item.option ? '<div class="cart-item-option-pill">'+item.option+'</div>' : '';
    var ptc = item.isDeposit ? 'deposit' : 'full';
    var ptl = item.isDeposit ? 'มัดจำ' : 'ราคาเต็ม';
    html+='<div class="cart-item" id="ci-'+item.cartId+'">';
    html+='<div class="cart-item-header">';
    html+='<img src="'+item.image+'" class="cart-item-img" data-fb="1">';
    html+='<div class="cart-item-info"><div class="cart-item-name">'+item.name+'</div>'+pill+'</div>';
    html+='<button class="cart-item-remove" data-cid="'+item.cartId+'">&#x2715;</button>';
    html+='</div>';
    if(oe) html+='<div style="margin:0 0 10px;">'+oe+'</div>';
    html+='<div class="cart-item-bottom">';
    html+='<label class="cart-deposit-toggle"><input type="checkbox" class="cdep" data-cid="'+item.cartId+'"'+(item.isDeposit?' checked':'')+'>  มัดจำ</label>';
    html+='<div class="cart-qty-stepper"><button class="cqb" data-cid="'+item.cartId+'" data-d="-1">&#x2212;</button><span id="cqty-'+item.cartId+'">'+item.qty+'</span><button class="cqb" data-cid="'+item.cartId+'" data-d="1">&#x2B;</button></div>';
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
  item.qty=Math.max(1,item.qty+d);
  var q=document.getElementById('cqty-'+cid), p=document.getElementById('cprice-'+cid);
  if(q) q.textContent=item.qty; if(p) p.textContent=formatCurrency(item.unitPrice*item.qty);
  updateCartBadge();
}
function editCartOption(cid,v){var item=findCartItem(cid);if(item)item.option=v;}
function editCartDeposit(cid,use){
  var item=findCartItem(cid); if(!item) return;
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

function checkoutFromCart() {
  if(!cart.length){showMessage('ตะกร้าว่างเปล่าค่ะ','error');return;}
  var name=(document.getElementById('customerName').value||'').trim();
  if(!name){closeCart();setTimeout(function(){showMessage('กรุณากรอกชื่อลูกค้าก่อนนะคะ','error');highlightInputError('customerName');},350);return;}
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
  populateProductTable();
  document.getElementById('loading').style.display='none';
  var form=document.getElementById('orderForm'); form.style.display='block'; form.classList.add('is-ready');
  addSearchListeners();
}

function populateProductTable() {
  var tbody=document.querySelector('#productTable tbody'); tbody.innerHTML='';
  var cartSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';
  for(var pi=0;pi<products.length;pi++){
    var p=products[pi];
    var s2=sid(p.id);
    var opts=Array.isArray(p.options)?p.options.filter(function(o){return o&&String(o).trim();}):[];
    var optHtml='';
    if(opts.length>0){
      if(opts.length<5){
        var ch='';
        for(var oi=0;oi<opts.length;oi++) ch+='<span class="option-chip" data-psid="'+s2+'" data-opt="'+opts[oi].replace(/"/g,'&quot;').replace(/'/g,'&#39;')+'">'+opts[oi]+'</span>';
        optHtml='<div class="options-wrapper"><div class="options-chips" id="popt-'+s2+'">'+ch+'</div></div>';
      } else {
        var sel='<option value="">-- เลือกตัวเลือก --</option>';
        for(var oi2=0;oi2<opts.length;oi2++) sel+='<option value="'+opts[oi2].replace(/"/g,'&quot;')+'">'+opts[oi2]+'</option>';
        optHtml='<div class="options-wrapper"><select class="option-select" id="popt-'+s2+'" data-psid="'+s2+'">'+sel+'</select></div>';
      }
    }
    var row=tbody.insertRow();
    row.innerHTML=
      '<td><img src="'+p.image+'" alt="'+String(p.name||'').replace(/"/g,'&quot;')+'" class="product-image" loading="lazy" width="50" height="50" data-fb="1"></td>'+
      '<td style="font-weight:600;">'+String(p.name||'')+'</td>'+
      '<td class="center-align" style="color:var(--primary);font-weight:700;">'+formatCurrency(Number(p.price)||0)+'</td>'+
      '<td class="center-align"><div class="deposit-toggle"><span class="dep-price">'+formatCurrency(Number(p.deposit)||0)+'</span><label><input type="checkbox" class="depchk" data-psid="'+s2+'"> มัดจำ</label></div></td>'+
      '<td class="prod-action-cell">'+optHtml+'<div class="prod-qty-row"><button class="add-to-cart-btn atcbtn" data-psid="'+s2+'">'+cartSvg+' + ตะกร้า</button></div></td>';
  }
  var tbl=document.getElementById('productTable');
  tbl.onclick=function(e){
    var chip=e.target.closest('.option-chip');
    if(chip){selectChip(chip.getAttribute('data-psid'),chip.getAttribute('data-opt'),chip);return;}
    var ab=e.target.closest('.atcbtn');
    if(ab){addToCartBySid(ab.getAttribute('data-psid'));return;}
  };
  tbl.onchange=function(e){
    if(e.target.classList.contains('option-select')){setPendingOpt(e.target.getAttribute('data-psid'),e.target.value);return;}
    if(e.target.classList.contains('depchk')){setPendingDep(e.target.getAttribute('data-psid'),e.target.checked);return;}
  };
  var imgs=tbody.querySelectorAll('img[data-fb]');
  for(var i=0;i<imgs.length;i++) imgs[i].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[i]);
}

function selectChip(s2,opt,el){
  var p=findProductBySid(s2); if(!p) return;
  if(p.pendingOption===opt){p.pendingOption=null;el.classList.remove('selected');}
  else{p.pendingOption=opt;var c=document.getElementById('popt-'+s2);if(c){var chips=c.querySelectorAll('.option-chip');for(var i=0;i<chips.length;i++)chips[i].classList.remove('selected');}el.classList.add('selected');}
}
function setPendingOpt(s2,v){var p=findProductBySid(s2);if(p)p.pendingOption=v||null;}
function setPendingDep(s2,v){var p=findProductBySid(s2);if(p)p.pendingDeposit=!!v;}

function setFabVisible(v){document.getElementById('bottomBar').style.display=v?'flex':'none';}

function renderSummaryUI(cache) {
  var tq=0; for(var i=0;i<cache.items.length;i++) tq+=cache.items[i].quantity;
  var m='<div class="summary-meta-chip">&#x1F464; '+cache.customerName+'</div>';
  if(cache.customerPhone) m+='<div class="summary-meta-chip">&#x1F4DE; '+cache.customerPhone+'</div>';
  m+='<div class="summary-meta-chip">&#x1F4E6; '+tq+' ชิ้น</div>';
  if(cache.hasDeposit) m+='<div class="summary-meta-chip accent">&#x1F4B0; มีรายการมัดจำ</div>';
  document.getElementById('summaryMeta').innerHTML=m;
  var html='<ul style="list-style:none;padding:0;margin:0;">';
  for(var j=0;j<cache.items.length;j++){var it=cache.items[j];html+=buildItemHtml(it.image,it.name,it.selectedOption,it.quantity,it.unitPrice,it.total,it.isDeposit,it.fullPrice*it.quantity);}
  html+='</ul>';
  document.getElementById('summaryContent').innerHTML=html;
  document.getElementById('totalPrice').textContent=cache.hasDeposit?formatCurrency(cache.total)+' (มัดจำ)':formatCurrency(cache.total);
  var form=document.getElementById('orderForm'); form.style.display='none'; form.classList.remove('is-ready');
  document.getElementById('summary').style.display='flex'; setFabVisible(false);
}

function editOrder(){
  summaryCache=null;
  var form=document.getElementById('orderForm'); form.style.display='block'; form.classList.add('is-ready');
  document.getElementById('summary').style.display='none'; setFabVisible(true);
}

function confirmOrder(){
  if(isSubmitted) return;
  if(!summaryCache||!summaryCache.items.length){showMessage('ไม่มีข้อมูลสรุปคำสั่งซื้อ','error');return;}
  isSubmitted=true;
  var btn=document.getElementById('confirmButton'); btn.disabled=true; btn.textContent='กำลังยืนยัน...';
  currentOrder=summaryCache;
  var oi=[];
  for(var i=0;i<summaryCache.items.length;i++){var it=summaryCache.items[i];oi.push({id:it.id,quantity:it.quantity,isDeposit:it.isDeposit,selectedOption:it.selectedOption||null});}
  google.script.run.withSuccessHandler(handleSubmitOk).withFailureHandler(handleSubmitFail)
    .submitOrderToSheet(selectedSheetId,summaryCache.customerName,summaryCache.customerPhone||'',oi);
}

function onOrderSuccess(){
  resetSubmitState();
  document.getElementById('mainContent').style.display='none';
  document.getElementById('summary').style.display='none';
  document.getElementById('confirmation').style.display='block';
  setFabVisible(false);
  var pr=currentOrder.customerPhone?'<p style="margin:2px 0 10px;font-size:0.88rem;color:var(--text-2);"><strong>เบอร์โทร:</strong> '+currentOrder.customerPhone+'</p>':'';
  var html='<p style="margin:0 0 2px;font-weight:700;font-size:0.95rem;">'+currentOrder.customerName+'</p>'+pr+'<ul style="list-style:none;padding:0;margin:0;">';
  var total=0,hasDeposit=false;
  for(var i=0;i<currentOrder.items.length;i++){
    var item=currentOrder.items[i], p=findProduct(item.id); if(!p) continue;
    var up=item.isDeposit?Number(p.deposit):Number(p.price), it=up*item.quantity;
    if(item.isDeposit) hasDeposit=true;
    html+=buildItemHtml(p.image,p.name,item.selectedOption,item.quantity,up,it,item.isDeposit,p.price*item.quantity);
    total+=Number(it)||0;
  }
  html+='</ul>';
  document.getElementById('orderSummary').innerHTML=html;
  document.getElementById('orderTotal').textContent=(hasDeposit?'ยอดรวมทั้งสิ้น: '+formatCurrency(total)+' (มัดจำ)':'ยอดรวมทั้งสิ้น: '+formatCurrency(total));
  showMessage('ยืนยันคำสั่งซื้อเรียบร้อยแล้ว','success');
  setTimeout(downloadReceipt,1500);
}

function buildItemHtml(img,name,option,qty,up,total,isDeposit,fullPrice){
  var hint=isDeposit?'<div class="receipt-item-hint">ราคาเต็ม: '+formatCurrency(fullPrice)+'</div>':'';
  var opt=option?'<div class="receipt-item-option">'+option+'</div>':'';
  return '<li class="receipt-item"><img src="'+safeImg(img)+'" class="receipt-item-img" data-fb="1"><div class="receipt-item-body"><div class="receipt-item-name">'+name+'</div>'+opt+'<div class="receipt-item-price">'+qty+' x '+formatCurrency(up)+' = <strong>'+formatCurrency(total)+'</strong></div>'+hint+'</div></li>';
}

function resetForm(){
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

function handleSubmitOk(r){var res=JSON.parse(r);if(res.status==='Success')onOrderSuccess();else{resetSubmitState();showMessage(res.message,'error');}}
function handleSubmitFail(e){resetSubmitState();showMessage('เกิดข้อผิดพลาดในการส่งคำสั่งซื้อ','error');console.error(e);}
function resetSubmitState(){
  isSubmitted=false;
  var btn=document.getElementById('confirmButton');
  if(btn){btn.disabled=false;btn.textContent='ยืนยันคำสั่งซื้อ \u2192';}
}

function downloadReceipt() {
  var receipt = document.getElementById('receipt');
  var list    = document.querySelector('#orderSummary ul');
  var btn     = document.getElementById('downloadBtn');
 
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
 
      // ── Step 2: Try programmatic download (works on Android/desktop) ──
      try {
        var a = document.createElement('a');
        a.download = 'receipt_' + Date.now() + '.png';
        a.href = dataUrl;
        a.click();
      } catch(e) {}
 
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
      preview.style.cssText = 'width:100%;display:block;';
      preview.alt = 'ใบเสร็จ';
 
      previewWrap.innerHTML = '';
      previewWrap.appendChild(hint);
      previewWrap.appendChild(preview);
 
      // Restore button
      btn.disabled = false;
      btn.textContent = '⬇ ดาวน์โหลดใบเสร็จ';
    })
    .catch(function(err) {
      console.error('html2canvas error:', err);
      if (list) { list.style.maxHeight = om; list.style.overflowY = oo; }
      btn.disabled = false;
      btn.textContent = '⬇ ดาวน์โหลดใบเสร็จ';
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
  var t=document.getElementById('productSearch').value.toLowerCase();
  var rows=document.querySelectorAll('#productTable tbody tr');
  for(var i=0;i<rows.length;i++){
    var td=rows[i].querySelector('td:nth-child(2)');
    rows[i].style.display=(td&&td.textContent.toLowerCase().indexOf(t)!==-1)?'':'none';
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
    html+='<div class="hub-card'+(isOpen?'':' closed')+'" data-shid="'+item.sheetId+'">';
    html+='<div class="hub-card-img-wrap"><img src="'+safeImg(item.image)+'" class="hub-card-img" data-fb="1"></div>';
    html+='<div class="hub-card-body"><div class="hub-card-name">'+item.name+'</div>';
    html+='<div class="hub-card-desc">'+(item.description||(isOpen?'คลิกเพื่อสั่งซื้อ':'ปิดรับออเดอร์แล้วค่ะ'))+'</div>';
    html+='<div class="hub-card-footer">'+badge+arrow+'</div></div></div>';
  }
  grid.innerHTML=html;
  grid.onclick=function(e){var c=e.target.closest('.hub-card');if(c&&!c.classList.contains('closed'))selectOrderList(c.getAttribute('data-shid'));};
  var imgs=grid.querySelectorAll('img[data-fb]');
  for(var k=0;k<imgs.length;k++) imgs[k].onerror=(function(img){return function(){img.src=PLACEHOLDER;};})(imgs[k]);
}

function selectOrderList(sheetId){
  if(!sheetId) return;
  var name=(document.getElementById('customerName').value||'').trim();
  if(!name){showMessage('กรุณากรอกชื่อลูกค้าก่อนเลือกรายการสั่งซื้อนะคะ','error');highlightInputError('customerName');return;}
  var phone=(document.getElementById('customerPhone').value||'').trim();
  if(!phone){showMessage('กรุณากรอกเบอร์โทรก่อนเลือกรายการสั่งซื้อนะคะ','error');highlightInputError('customerPhone');return;}
  if(!isValidPhone(phone)){showMessage('เบอร์โทรไม่ถูกต้อง (06x/08x/09x 10 หลัก)','error');highlightInputError('customerPhone');return;}
  selectedSheetId=sheetId;
  document.getElementById('headerUsername').textContent=name;
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
    html+='<button class="side-menu-item'+(isCurrent?' active':'')+'" data-shid="'+item.sheetId+'" data-open="'+(isOpen?'1':'0')+'" data-cur="'+(isCurrent?'1':'0')+'" '+dis+'>';
    html+='<img src="'+safeImg(item.image)+'" class="side-menu-item-img" data-fb="1">';
    html+='<div><div class="side-menu-item-name">'+item.name+'</div>'+st+'</div></button>';
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
  closeSideMenu(); cart=[];updateCartBadge();
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
}

// Static event bindings
document.getElementById('cartOverlay').onclick = closeCart;
document.getElementById('cartCloseBtn').onclick = closeCart;
document.getElementById('cartClearBtn').onclick = clearCart;
document.getElementById('checkoutBtn').onclick = checkoutFromCart;
document.getElementById('cartBarBtn').onclick = openCart;
document.getElementById('menuToggleBtn').onclick = openSideMenu;
document.getElementById('sideMenuOverlay').onclick = closeSideMenu;
document.getElementById('sideMenuCloseBtn').onclick = closeSideMenu;
document.getElementById('sideMenuBackBtn').onclick = function(){closeSideMenu();resetForm();};
document.getElementById('listBtn').onclick = function(){setView('list');};
document.getElementById('gridBtn').onclick = function(){setView('grid');};
document.getElementById('editOrderBtn').onclick = editOrder;
document.getElementById('confirmButton').onclick = confirmOrder;
document.getElementById('downloadBtn').onclick = downloadReceipt;
document.getElementById('newOrderBtn').onclick = resetForm;
document.getElementById('hubSearch').oninput = function(){filterHubCards(this.value);};
document.getElementById('hubSearchClear').onclick = function(){document.getElementById('hubSearch').value='';filterHubCards('');};
document.getElementById('customerName').onkeydown = function(e){if(e.key==='Enter')e.preventDefault();};
document.getElementById('customerPhone').onkeydown = function(e){if(e.key==='Enter')e.preventDefault();};
window.addEventListener('beforeunload',function(e){if(currentOrder&&!isSubmitted){e.preventDefault();e.returnValue='';}});

document.getElementById('bottomBar').style.display='none';
loadHubPage();
updateCartBadge();
setView('grid');
