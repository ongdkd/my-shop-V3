// Discount maths shared by admin (setting a discount), the shop and POS (showing it).
// A product on discount keeps its normal price in price_before; price is what customers pay.
(function (root) {
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  // "20% off ฿150" → ฿120, rounded to whole baht (prices in the shop are whole baht)
  function priceFromPercent(base, pct) {
    base = Number(base) || 0; pct = Number(pct) || 0;
    return Math.max(0, Math.round(base * (100 - pct) / 100));
  }
  // ฿150 → ฿120 is 20% off (whole percent)
  function percentOff(base, price) {
    base = Number(base) || 0; price = Number(price) || 0;
    if (base <= 0 || price >= base) return 0;
    return Math.round((base - price) / base * 100); // whole percent: 33% not 33.3%
  }
  // Is this product on discount right now?
  function isOn(p) {
    return !!p && p.priceBefore !== null && p.priceBefore !== undefined && Number(p.priceBefore) > Number(p.price);
  }
  // Chip text: "ลด 20%"; under 1% (odd prices) it says how much in baht
  function label(p) {
    if (!isOn(p)) return '';
    var pct = percentOff(p.priceBefore, p.price);
    return pct >= 1 ? 'ลด ' + pct + '%' : 'ลด ฿' + round2(p.priceBefore - p.price);
  }
  // Checks a new discounted price against the normal price; '' when fine
  function problem(base, price) {
    base = Number(base); price = Number(price);
    if (!(price >= 0) || isNaN(price)) return 'กรุณาใส่ราคาหลังลด';
    if (price >= base) return 'ราคาหลังลดต้องน้อยกว่าราคาปกติ (฿' + base + ')';
    return '';
  }
  var api = { priceFromPercent: priceFromPercent, percentOff: percentOff, isOn: isOn, label: label, problem: problem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Discount = api;
})(typeof window !== 'undefined' ? window : globalThis);
