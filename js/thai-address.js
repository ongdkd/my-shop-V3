// thai-address.js — Thai subdistrict / district / province / postcode lookup
// for address forms: autocomplete, validation, and splitting a pasted
// address into fields. Data: thai-address-database (7,4xx subdistricts),
// loaded on first use. Names match what couriers (iShip) expect.
(function () {
  'use strict';

  var DATA_URL = 'https://cdn.jsdelivr.net/npm/thai-address-database@0.0.33/database/db.json';
  var rows = null, loading = null;

  // db.json is compressed: names reference a lookup table and single
  // letters stand for common words
  function decode(raw) {
    var lookup = raw.lookup.split('|'), words = raw.words.split('|'), out = [];
    function t(x) {
      return (typeof x === 'number' ? lookup[x] : x).replace(/[A-Z]/ig, function (m) {
        var c = m.charCodeAt(0); return words[c < 97 ? c - 65 : 26 + c - 97];
      });
    }
    raw.data.forEach(function (p) {
      p[1].forEach(function (a) {
        a[1].forEach(function (d) {
          (Array.isArray(d[1]) ? d[1] : [d[1]]).forEach(function (z) {
            out.push({ district: t(d[0]), amphoe: t(a[0]), province: t(p[0]), zipcode: String(z) });
          });
        });
      });
    });
    return out;
  }
  function load() {
    if (rows) return Promise.resolve(rows);
    if (!loading) {
      loading = fetch(DATA_URL).then(function (r) {
        if (!r.ok) throw new Error('โหลดข้อมูลที่อยู่ไม่สำเร็จ');
        return r.json();
      }).then(function (raw) { rows = decode(raw); return rows; })
        .catch(function (e) { loading = null; throw e; });
    }
    return loading;
  }

  // Common short forms people type
  var PROVINCE_ALIAS = { 'กทม': 'กรุงเทพมหานคร', 'กรุงเทพ': 'กรุงเทพมหานคร', 'กรุงเทพฯ': 'กรุงเทพมหานคร', 'โคราช': 'นครราชสีมา' };
  function norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

  // Rows matching every word of q (any field); rows whose `field` starts
  // with q come first
  function search(q, field, limit) {
    if (!rows) return [];
    q = norm(q);
    if (PROVINCE_ALIAS[q]) q = norm(PROVINCE_ALIAS[q]);
    if (!q || (/^\d+$/.test(q) ? q.length < 3 : q.length < 2)) return [];
    var tokens = q.split(' '), first = [], rest = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], hay = (r.district + ' ' + r.amphoe + ' ' + r.province + ' ' + r.zipcode).toLowerCase();
      if (!tokens.every(function (t) { return hay.indexOf(t) !== -1; })) continue;
      (field && String(r[field]).toLowerCase().indexOf(q) === 0 ? first : rest).push(r);
      if (first.length >= (limit || 8)) break;
    }
    return first.concat(rest).slice(0, limit || 8);
  }

  function valid(p) {
    return !!rows && rows.some(function (r) {
      return r.district === p.district && r.amphoe === p.amphoe && r.province === p.province && r.zipcode === String(p.zipcode);
    });
  }

  // "ชื่อ 08x… บ้านเลขที่ ถนน ต.… อ.… จ.… 10220" → fields (best effort)
  function parse(text) {
    var out = { name: '', phone: '', address: '', district: '', amphoe: '', province: '', zipcode: '' };
    var s = String(text || '').replace(/\r/g, '');
    var ph = /(?:\+66|0)[\s-]?\d(?:[\s-]?\d){7,8}/.exec(s);
    if (ph) { out.phone = ph[0].replace(/[\s-]/g, '').replace(/^\+66/, '0'); s = s.replace(ph[0], ' '); }
    var zips = s.match(/\b\d{5}\b/g);
    var zip = zips ? zips[zips.length - 1] : '';
    var flat = s.replace(/\s+/g, ' ');
    var pool = rows ? rows.filter(function (r) { return !zip || r.zipcode === zip; }) : [];
    var best = null, bestScore = 0;
    pool.forEach(function (r) {
      var sc = (flat.indexOf(r.district) !== -1 ? 3 : 0) + (flat.indexOf(r.amphoe) !== -1 ? 2 : 0) +
        (flat.indexOf(r.province) !== -1 || Object.keys(PROVINCE_ALIAS).some(function (k) { return PROVINCE_ALIAS[k] === r.province && flat.indexOf(k) !== -1; }) ? 1 : 0) +
        (zip ? 1 : 0);
      if (sc > bestScore) { best = r; bestScore = sc; }
    });
    // Need more than the postcode alone, unless it has a single subdistrict
    if (best && (bestScore > 1 || pool.length === 1)) {
      out.district = best.district; out.amphoe = best.amphoe; out.province = best.province; out.zipcode = best.zipcode;
      // Only the last mention: "ถ.สายไหม แขวงสายไหม เขตสายไหม" keeps the street name
      var cut = function (w) { var i = s.lastIndexOf(w); if (i === -1) return false; s = s.slice(0, i) + ' ' + s.slice(i + w.length); return true; };
      cut(best.province) || Object.keys(PROVINCE_ALIAS).filter(function (k) { return PROVINCE_ALIAS[k] === best.province; })
        .sort(function (a, b) { return b.length - a.length; }).some(cut);
      cut(best.amphoe); cut(best.district);
    } else if (zip) out.zipcode = zip;
    if (zip) s = s.split(zip).join(' ');
    s = s.replace(/(ตำบล|แขวง|อำเภอ|เขต|จังหวัด|ต\.|อ\.|จ\.|โทร\.?|tel\.?|เบอร์)/gi, ' ');
    var lines = s.split('\n').map(function (l) { return l.replace(/[\s,]+/g, ' ').trim(); }).filter(Boolean);
    if (lines.length > 1 && !/\d/.test(lines[0])) { out.name = lines.shift(); out.address = lines.join(' '); }
    else {
      var one = lines.join(' '), m = /^([^\d]+?)\s+(?=\d)/.exec(one);
      if (m) { out.name = m[1].trim(); out.address = one.slice(m[0].length).trim(); } else out.address = one;
    }
    out.address = out.address.replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
    return out;
  }

  function format(p) {
    return [p.name, p.phone, p.address, [p.district && 'ต.' + p.district, p.amphoe && 'อ.' + p.amphoe, p.province && 'จ.' + p.province, p.zipcode].filter(Boolean).join(' ')]
      .filter(Boolean).join('\n');
  }

  // Autocomplete on the subdistrict / district / province / postcode inputs:
  // picking a suggestion fills all four. inputs = { district, amphoe, province, zipcode }
  function attach(inputs, onPick) {
    var keys = ['district', 'amphoe', 'province', 'zipcode'];
    var list = document.createElement('ul'); list.className = 'ta-list'; list.setAttribute('role', 'listbox'); list.hidden = true;
    document.body.appendChild(list);
    var active = -1, items = [], owner = null;
    function close() { list.hidden = true; active = -1; owner = null; }
    function pick(r) {
      keys.forEach(function (k) { inputs[k].value = r[k]; });
      close();
      if (onPick) onPick(r);
    }
    function show(input, field) {
      items = search(input.value, field, 8);
      list.innerHTML = '';
      if (!items.length) { close(); return; }
      items.forEach(function (r, i) {
        var li = document.createElement('li'); li.setAttribute('role', 'option'); li.className = 'ta-item';
        var a = document.createElement('strong'); a.textContent = r.district; li.appendChild(a);
        li.appendChild(document.createTextNode(' » ' + r.amphoe + ' » ' + r.province + ' '));
        var z = document.createElement('span'); z.textContent = r.zipcode; li.appendChild(z);
        li.onmousedown = function (e) { e.preventDefault(); pick(r); };
        list.appendChild(li);
      });
      // A modal <dialog> sits in the top layer: the list must live inside it to show
      var host = input.closest('dialog') || document.body;
      if (list.parentNode !== host) host.appendChild(list);
      var box = input.getBoundingClientRect();
      list.style.left = Math.max(8, Math.min(box.left, innerWidth - 328)) + 'px';
      list.style.top = (box.bottom + 4) + 'px';
      list.style.minWidth = Math.min(box.width, innerWidth - 16) + 'px';
      list.hidden = false; active = -1; owner = input;
    }
    function mark() { Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('on', i === active); }); }
    keys.forEach(function (k) {
      var inp = inputs[k];
      inp.setAttribute('autocomplete', 'off');
      inp.addEventListener('input', function () { load().then(function () { if (document.activeElement === inp) show(inp, k); }).catch(function () {}); });
      inp.addEventListener('focus', load);
      inp.addEventListener('blur', function () { setTimeout(function () { if (owner === inp) close(); }, 150); });
      inp.addEventListener('keydown', function (e) {
        if (list.hidden || owner !== inp) return;
        if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); mark(); e.preventDefault(); }
        else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); mark(); e.preventDefault(); }
        else if (e.key === 'Enter' && active >= 0) { pick(items[active]); e.preventDefault(); }
        else if (e.key === 'Escape') close();
      });
    });
    // The list is positioned for the viewport; it would drift on scroll
    window.addEventListener('scroll', close, true);
    return { close: close };
  }

  window.ThaiAddress = { load: load, search: search, valid: valid, parse: parse, format: format, attach: attach };
})();
