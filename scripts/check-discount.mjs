// Behaviour check for the discount maths (js/discount.js)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../js/discount.js');

assert.equal(D.priceFromPercent(150, 20), 120);
assert.equal(D.priceFromPercent(199, 15), 169);        // 169.15 → whole baht
assert.equal(D.priceFromPercent(100, 100), 0);
assert.equal(D.priceFromPercent(100, 150), 0);         // never below 0
assert.equal(D.percentOff(150, 120), 20);
assert.equal(D.percentOff(150, 100), 33);      // whole percent
assert.equal(D.percentOff(150, 150), 0);
assert.equal(D.percentOff(0, 0), 0);

assert.equal(D.isOn({ price: 120, priceBefore: 150 }), true);
assert.equal(D.isOn({ price: 120, priceBefore: null }), false);
assert.equal(D.isOn({ price: 160, priceBefore: 150 }), false); // edited above the old price: not a discount
assert.equal(D.label({ price: 120, priceBefore: 150 }), 'ลด 20%');
assert.equal(D.label({ price: 100, priceBefore: 150 }), 'ลด 33%');
assert.equal(D.label({ price: 999, priceBefore: 1000 }), 'ลด ฿1');
assert.equal(D.label({ price: 120 }), '');

assert.equal(D.problem(150, 120), '');
assert.notEqual(D.problem(150, 150), '');
assert.notEqual(D.problem(150, NaN), '');
console.log('check-discount: ok');
