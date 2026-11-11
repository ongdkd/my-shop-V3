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

  // Spaces, case and punctuation don't matter: "All in" = "allin", "Mar26" = "mar 26"
  function squash(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_.,:;'"’`*()[\]{}!?/\\|+&#@~]+/g, '');
  }

  // terms: [{ kind, tag, aliases: [] }] → a matcher, longest spellings first so
  // "มินิสแตนดี้" wins over "สแตนดี้" when both could match the same words
  function compile(terms) {
    var list = [];
    (terms || []).forEach(function (t) {
      [t.tag].concat(t.aliases || []).forEach(function (a) {
        var k = squash(a);
        if (k.length >= 2) list.push({ key: k, kind: t.kind, tag: t.tag, minus: (t.minus || []).map(squash).filter(Boolean) });
      });
    });
    list.sort(function (a, b) { return b.key.length - a.key.length; });
    return list;
  }

  // text → { kind: [tags] }. A spelling found inside a longer one already used
  // doesn't count twice; a term's "minus" words veto it ("เซน" not in "เซนย่า").
  function tagsOf(text, matcher) {
    var s = squash(text), used = [], out = {};
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
          break;
        }
        at = s.indexOf(m.key, at + 1);
      }
    });
    return out;
  }

  var api = { KINDS: KINDS, squash: squash, compile: compile, tagsOf: tagsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Tags = api;
})(this);
