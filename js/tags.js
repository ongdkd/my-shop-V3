// Tags: what a product or order is about, read from its text with a dictionary of
// terms and their other spellings ("ซาเวีย", "เซเวียร์", "Xavier" → ซาเวียร์).
// The dictionary lives in the tag_terms table, edited in admin (แท็ก). Nothing is
// stored on the items: their tags follow the dictionary as it grows.
(function (root) {
  var KINDS = [
    { id: 'series', label: 'เรื่อง / ซีรีส์' },
    { id: 'char', label: 'ตัวละคร' },
    { id: 'type', label: 'ประเภทสินค้า' },
    { id: 'brand', label: 'ร้าน / แบรนด์' },
    { id: 'sale', label: 'แบบการขาย' }
  ];
  // Words that are in names but say nothing ("ซองดำ", "Stage Ver."): matched like a
  // tag so they stop showing up as unknown, never shown as one
  var SKIP = { id: 'skip', label: 'คำที่ข้าม (ไม่ใช่แท็ก)' };

  var DROP = /[\s\-_.,:;'"’`*()[\]{}!?/\\|+&#@~]/;

  // Spaces, case and punctuation don't matter: "All in" = "allin", "Mar26" = "mar 26"
  function squash(s) {
    return squashMap(s).s;
  }
  // The squashed text, and where each of its characters sits in the original
  function squashMap(text) {
    var src = String(text || ''), s = '', at = [];
    for (var i = 0; i < src.length; i++) {
      var c = src.charAt(i);
      if (DROP.test(c)) continue;
      var l = c.toLowerCase();
      if (l.length !== 1) l = c;
      s += l; at.push(i);
    }
    return { s: s, at: at, src: src };
  }

  // terms: [{ kind, tag, aliases: [] }] → a matcher, longest spellings first so
  // "มินิสแตนดี้" wins over "สแตนดี้" when both could match the same words
  function compile(terms) {
    var list = [];
    (terms || []).forEach(function (t) {
      var raw = [t.tag].concat(t.aliases || []).map(function (a) { return String(a).toLowerCase().trim(); }).filter(Boolean);
      raw.forEach(function (a) {
        var k = squash(a);
        if (k.length >= 2) list.push({ key: k, kind: t.kind, tag: t.tag, raw: raw, minus: (t.minus || []).map(squash).filter(Boolean) });
      });
    });
    list.sort(function (a, b) { return b.key.length - a.key.length; });
    return list;
  }

  // A spelling found inside a longer one already used doesn't count twice; a
  // term's "minus" words veto it ("เซน" not in "เซนย่า").
  function scan(s, matcher) {
    var used = [], out = {};
    matcher.forEach(function (m) {
      var at = s.indexOf(m.key);
      while (at !== -1) {
        var end = at + m.key.length;
        var inside = used.some(function (u) { return at >= u[0] && end <= u[1]; });
        var vetoed = m.minus.some(function (w) { var i = s.indexOf(w); return i !== -1 && i <= at && i + w.length >= end; });
        if (!inside && !vetoed) {
          used.push([at, end]);
          var arr = out[m.kind] = out[m.kind] || [];
          if (arr.indexOf(m.tag) === -1) arr.push(m.tag);
        }
        at = s.indexOf(m.key, at + 1);
      }
    });
    return { tags: out, used: used };
  }

  // text → { kind: [tags] }
  function tagsOf(text, matcher) {
    var t = scan(squash(text), matcher).tags;
    delete t.skip;
    return t;
  }

  // A product inside a list: what its own name says wins. The list's name only
  // fills in what the name leaves out, so "Rafayel's Birthday" sold in the
  // "Caleb's Birthday" list is Rafayel's alone. Brand and sale tags add up.
  function tagsOfItem(name, context, matcher) {
    var t = tagsOf(name, matcher);
    if (!context) return t;
    var c = tagsOf(context, matcher);
    Object.keys(c).forEach(function (k) {
      if (!t[k]) t[k] = c[k];
      else if (k === 'brand' || k === 'sale') c[k].forEach(function (x) { if (t[k].indexOf(x) === -1) t[k].push(x); });
    });
    return t;
  }

  // Words that never need a tag: MD, Ver.2, Mar26, 30ml, a lone letter, a number
  var NOISE = /^(md|x|ver\d*|v\d+|vol\d*|no\d*|set|new|pre|order|(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\d*|\d+[a-zก-๙]{0,4}|[a-z])$/;

  // text → { tags, rest }: rest is the words no term explains, the ones to teach
  // the dictionary next ("ซฮง" in "ซฮงสุ่ม…", "Boxset", "แผ่นรองเม้าส์")
  function explain(text, matcher) {
    var m = squashMap(text), r = scan(m.s, matcher), taken = [];
    r.used.forEach(function (u) { for (var i = u[0]; i < u[1]; i++) taken[i] = true; });
    var rest = [], cur = '', last = -2;
    function flush() {
      var k = cur.toLowerCase();
      if (k.length >= 2 && /[a-zก-๙]/.test(k) && !NOISE.test(k) && rest.indexOf(cur) === -1) rest.push(cur);
      cur = '';
    }
    for (var i = 0; i < m.s.length; i++) {
      if (taken[i]) { flush(); last = -2; continue; }
      if (m.at[i] !== last + 1) flush();
      cur += m.src.charAt(m.at[i]); last = m.at[i];
    }
    flush();
    delete r.tags.skip;
    return { tags: r.tags, rest: rest };
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i], low = i;
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (cur[j] < low) low = cur[j];
      }
      if (low > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // A word that looks like a misspelling of a known term ("Mecury" → Mercury):
  // one letter off for words of 5+, two for 9+. Returns { kind, tag } or null.
  function near(word, matcher) {
    var w = squash(word), best = null, bestD = 99;
    if (w.length < 5) return null;
    var max = w.length >= 9 ? 2 : 1;
    matcher.forEach(function (m) {
      if (m.kind === 'skip' || m.key.length < 5) return;
      var d = editDistance(w, m.key, max);
      if (d <= max && d < bestD) { bestD = d; best = { kind: m.kind, tag: m.tag }; }
    });
    return best;
  }

  // Every spelling of the tags an item has, for search boxes: typing "xavier"
  // finds what is written "ซาเวีย"
  function words(tags, matcher) {
    var out = [], seen = {};
    matcher.forEach(function (m) {
      if (seen[m.kind + '|' + m.tag] || !tags[m.kind] || tags[m.kind].indexOf(m.tag) === -1) return;
      seen[m.kind + '|' + m.tag] = true;
      out.push(m.raw.join(' '));
    });
    return out.join(' ');
  }

  // Does any term (skip words included) appear in the text?
  function hits(text, matcher) { return scan(squash(text), matcher).used.length > 0; }

  var api = { hits: hits, KINDS: KINDS, SKIP: SKIP, squash: squash, compile: compile, tagsOf: tagsOf, tagsOfItem: tagsOfItem, explain: explain, near: near, words: words };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tags = api;
})(this);
