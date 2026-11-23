// Christmas runs Dec 1-Jan 6. Delay its reveal only for the first-visit curtain show.
(function () {
  var query = new URLSearchParams(location.search), q = query.get('theme'), d = new Date();
  var on = q ? q === 'xmas' : d.getMonth() === 11 || (d.getMonth() === 0 && d.getDate() <= 6);
  if (!on) return;
  var applied, root = document.documentElement;
  function hats() {
    document.querySelectorAll('img.shop-logo, img.sidebar-logo-img').forEach(function (img) {
      if (img.parentElement.classList.contains('xmas-logo')) return;
      var hat = document.createElement('span');
      hat.className = 'xmas-logo'; img.replaceWith(hat); hat.appendChild(img);
    });
  }
  function applyChristmas() {
    if (applied) return applied;
    root.classList.add('xmas');
    applied = new Promise(function (resolve) {
      var css = document.createElement('link'); css.rel = 'stylesheet';
      css.href = 'css/theme-xmas.css?v=xmas-6';
      css.onload = css.onerror = resolve; document.head.appendChild(css);
      setTimeout(resolve, 2500);
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hats, { once: true });
    else hats();
    return applied;
  }
  var year = d.getFullYear() - (d.getMonth() === 0 ? 1 : 0);
  var key = 'kaga-xmas-intro-' + year, due = false;
  var page = location.pathname.split('/').pop() || 'index.html';
  if (['index.html','status.html','admin.html'].includes(page) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    try {
      var seen = localStorage.getItem(key);
      localStorage.setItem(key + '-probe', '1'); localStorage.removeItem(key + '-probe');
      due = query.get('xmasIntro') === '1' || seen !== 'done';
    } catch (_) { /* Storage unavailable: apply the theme without a recurring show. */ }
  }
  function finish() {
    applyChristmas();
    root.removeAttribute('data-xmas-intro');
    document.getElementById('xmas-intro-hide')?.remove();
    try { localStorage.setItem(key, 'done'); } catch (_) {}
  }
  window.KagaSeason = Object.freeze({ applyChristmas: applyChristmas, finishIntro: finish });
  if (!due) { applyChristmas(); return; }
  root.setAttribute('data-xmas-intro', 'pending');
  var hide = document.createElement('style'); hide.id = 'xmas-intro-hide';
  hide.textContent = 'html[data-xmas-intro] #faye{visibility:hidden!important}'; document.head.appendChild(hide);
  function start() {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'css/xmas-intro.css?v=2'; document.head.appendChild(css);
    var script = document.createElement('script'); script.src = 'js/xmas-intro.js?v=2';
    var timeout = setTimeout(finish, 10000);
    script.onload = function () { clearTimeout(timeout); };
    script.onerror = function () { clearTimeout(timeout); finish(); }; document.head.appendChild(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
