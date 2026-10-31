// couriers.js — courier names and tracking links (codes follow iShip's
// courier_code list, e.g. FlashExpress, KerryExpress, THP_eParcel).
(function () {
  'use strict';

  // Picker for parcels shipped without iShip; iShip bookings store iShip's own code
  var LIST = [
    { code: 'THP_eParcel', name: 'ไปรษณีย์ไทย' },
    { code: 'FlashExpress', name: 'Flash Express' },
    { code: 'KerryExpress', name: 'KEX Express (Kerry)' },
    { code: 'JntExpress', name: 'J&T Express' },
    { code: 'ShopeeExpress', name: 'SPX Express' },
    { code: 'BestExpress', name: 'Best Express' },
    { code: 'DHL', name: 'DHL eCommerce' },
    { code: 'NinjaVan', name: 'Ninja Van' },
    { code: 'Other', name: 'อื่น ๆ' }
  ];

  function family(code, tracking) {
    var c = String(code || '');
    if (/^THP|thailandpost|EMS/i.test(c)) return 'thp';
    if (/^Flash/i.test(c)) return 'flash';
    if (/^Kerry|KEX/i.test(c)) return 'kerry';
    if (c) return 'other';
    // No courier saved: guess from the number's shape
    var t = String(tracking || '').trim().toUpperCase();
    if (/^[A-Z]{2}\d{9}TH$/.test(t)) return 'thp';
    if (/^TH\d{2}[0-9A-Z]{8,}$/.test(t)) return 'flash';
    return 'other';
  }

  // Couriers with a stable public tracking page link straight to it; the
  // rest go to 17TRACK, which looks up Thai couriers by number
  function trackUrl(code, tracking) {
    var t = encodeURIComponent(String(tracking || '').trim());
    if (!t) return '';
    switch (family(code, tracking)) {
      case 'thp': return 'https://track.thailandpost.co.th/?trackNumber=' + t;
      case 'flash': return 'https://www.flashexpress.co.th/fle/tracking?se=' + t;
      case 'kerry': return 'https://th.kex-express.com/th/track/?track=' + t;
      default: return 'https://t.17track.net/th#nums=' + t;
    }
  }

  var extra = {}; // names learned from iShip's courier list
  function name(code) {
    if (!code) return '';
    if (extra[code]) return extra[code];
    for (var i = 0; i < LIST.length; i++) if (LIST[i].code === code) return LIST[i].name;
    var f = family(code);
    return f === 'thp' ? 'ไปรษณีย์ไทย' : f === 'flash' ? 'Flash Express' : f === 'kerry' ? 'KEX Express' : code;
  }
  function learn(list) { (list || []).forEach(function (c) { if (c && c.code) extra[c.code] = c.name || c.code; }); }

  window.Couriers = { list: LIST, name: name, trackUrl: trackUrl, learn: learn };
})();
