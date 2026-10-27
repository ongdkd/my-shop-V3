// Behaviour check for adminPushStockToShop (warehouse → order list import).
// Runs the real js/api.js against a tiny in-memory stand-in for Supabase.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../js/api.js', import.meta.url), 'utf8');

function makeDb(tables) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function query(table) {
    const st = { filters: [], op: 'select', payload: null };
    const q = {
      select() { return q; }, order() { return q; }, range() { return q; }, limit() { return q; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return q; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return q; },
      not(c, op, v) { st.filters.push((r) => r[c] !== null && r[c] !== undefined); return q; },
      insert(rows) { st.op = 'insert'; st.payload = rows; return q; },
      update(patch) { st.op = 'update'; st.payload = patch; return q; },
      upsert(rows) { st.op = 'upsert'; st.payload = rows; return q; },
      single() { st.single = true; return q; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); }
    };
    function run() {
      const t = tables[table] || (tables[table] = []);
      const match = (r) => st.filters.every((f) => f(r));
      if (st.op === 'insert') { st.payload.forEach((r) => t.push({ id: 'new' + t.length + Math.random().toString(16).slice(2, 6), ...clone(r) })); return { data: null, error: null }; }
      if (st.op === 'update') { t.filter(match).forEach((r) => Object.assign(r, clone(st.payload))); return { data: null, error: null }; }
      if (st.op === 'upsert') { st.payload.forEach((p) => { const r = t.find((x) => x.id === p.id); if (r) Object.assign(r, p); else t.push(clone(p)); }); return { data: null, error: null }; }
      const rows = clone(t.filter(match));
      return { data: st.single ? rows[0] : rows, error: null };
    }
    return q;
  }
  return {
    from: query,
    rpc: async () => ({ data: true, error: null }),
    auth: { getSession: async () => ({ data: { session: { user: { email: 'a@b' } } } }) }
  };
}

async function load(tables) {
  const db = makeDb(tables);
  const window = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'k', supabase: { createClient: () => db } };
  const ctx = { window, document: { addEventListener() {} }, console, Proxy, Promise, JSON, Math, Date, Object, Array, String, Number, setTimeout, URLSearchParams };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const api = window.__api;
  const call = async (fn, ...a) => JSON.parse(await api[fn](...a));
  const stock = await call('adminGetStockProducts'); // fills the rowIndex → id map
  const row = (id) => {
    for (const p of stock.products) { if (p.stockItemId === id) return p.rowIndex; for (const c of p.children) if (c.stockItemId === id) return c.rowIndex; }
  };
  return { call, row, tables, stock };
}

const base = () => ({
  stock_items: [
    { id: 'S', seq: 1, parent_id: null, code: 'S01', name: 'Single', image: '', price: 100, deposit: 30, yuan: 0, stock: 10, status: 'Open' },
    { id: 'U', seq: 2, parent_id: null, code: 'U01', name: 'Unlimited', image: '', price: 50, deposit: 0, yuan: 0, stock: null, status: 'Open' },
    { id: 'V', seq: 3, parent_id: null, code: '', name: 'Variants', image: '', price: 160, deposit: 0, yuan: 0, stock: null, status: 'Open' },
    { id: 'V1', seq: 4, parent_id: 'V', code: 'V01', name: 'Red', image: 'r.png', price: 0, deposit: 0, yuan: 0, stock: 5, status: 'Open' },
    { id: 'V2', seq: 5, parent_id: 'V', code: 'V02', name: 'Blue', image: '', price: 0, deposit: 0, yuan: 0, stock: 3, status: 'Open' },
    { id: 'V3', seq: 6, parent_id: 'V', code: 'V03', name: 'Green', image: '', price: 0, deposit: 0, yuan: 0, stock: 0, status: 'Open' },
    { id: 'V4', seq: 7, parent_id: 'V', code: 'V04', name: 'Secret', image: '', price: 0, deposit: 0, yuan: 0, stock: null, status: 'Open' }
  ],
  products: []
});
const stockOf = (t, id) => t.stock_items.find((s) => s.id === id).stock;
const listItems = (t) => t.products.filter((p) => p.list_id === 'L');

// 1) Fresh import: single qty, unlimited single, chosen variants only
{
  const { call, row, tables } = await load(base());
  const res = await call('adminPushStockToShop', 'L', [
    { parentRowIndex: row('S'), qty: 4 },
    { parentRowIndex: row('U'), qty: 1 },
    { parentRowIndex: row('V'), childQty: { [row('V1')]: 2, [row('V4')]: 1 } }
  ]);
  assert.equal(res.status, 'Success', res.message);
  assert.equal(res.added, 3); assert.equal(res.merged, 0);
  assert.equal(stockOf(tables, 'S'), 6, 'single: warehouse loses qty');
  assert.equal(stockOf(tables, 'U'), null, 'unlimited stays unlimited');
  assert.equal(stockOf(tables, 'V1'), 3, 'variant: only chosen amount leaves');
  assert.equal(stockOf(tables, 'V2'), 3, 'unchosen variant untouched');
  const [s, u, v] = listItems(tables);
  assert.equal(s.remaining, 4); assert.equal(u.remaining, null);
  assert.deepEqual(v.option_details.map((o) => [o.name, o.remaining]), [['Red', 2], ['Secret', null]]);
  assert.equal(v.remaining, null, 'an unlimited variant keeps the total unlimited');
  assert.equal(v.options, 'Red:V01,Secret:V04');
}

// 2) Re-import adds to the existing listings instead of failing / duplicating
{
  const { call, row, tables } = await load(base());
  await call('adminPushStockToShop', 'L', [
    { parentRowIndex: row('S'), qty: 4 },
    { parentRowIndex: row('V'), childQty: { [row('V1')]: 2 } }
  ]);
  const again = await load(tables); // reload maps like the page does
  const res = await again.call('adminPushStockToShop', 'L', [
    { parentRowIndex: again.row('S'), qty: 3 },
    { parentRowIndex: again.row('V'), childQty: { [again.row('V1')]: 1, [again.row('V2')]: 3 } }
  ]);
  assert.equal(res.status, 'Success', res.message);
  assert.equal(res.added, 0); assert.equal(res.merged, 2);
  assert.equal(listItems(tables).length, 2, 'no duplicate listings');
  const [s, v] = listItems(tables);
  assert.equal(s.remaining, 7, 'single: 4 + 3');
  assert.deepEqual(v.option_details.map((o) => [o.name, o.remaining]), [['Red', 3], ['Blue', 3]], 'existing variant summed, new one appended');
  assert.equal(v.remaining, 6);
  assert.equal(v.options, 'Red:V01,Blue:V02');
  assert.equal(stockOf(tables, 'S'), 3); assert.equal(stockOf(tables, 'V1'), 2); assert.equal(stockOf(tables, 'V2'), 0);
}

// 3) Older single listing without a warehouse link (same barcode) is merged and linked
{
  const t = base();
  t.products.push({ id: 'P-old', list_id: 'L', code: 'S01', name: 'Single', remaining: 2, options: '', option_details: [], source_stock_item_id: null });
  const { call, row, tables } = await load(t);
  const res = await call('adminPushStockToShop', 'L', [{ parentRowIndex: row('S'), qty: 1 }]);
  assert.equal(res.status, 'Success', res.message);
  assert.equal(listItems(tables).length, 1);
  assert.equal(listItems(tables)[0].remaining, 3);
  assert.equal(listItems(tables)[0].source_stock_item_id, 'S');
}

// 4) Not enough stock: nothing is written at all
{
  const { call, row, tables } = await load(base());
  const res = await call('adminPushStockToShop', 'L', [
    { parentRowIndex: row('S'), qty: 2 },
    { parentRowIndex: row('V'), childQty: { [row('V2')]: 9 } }
  ]);
  assert.equal(res.status, 'Error');
  assert.match(res.message, /Blue/);
  assert.equal(listItems(tables).length, 0, 'no listing created');
  assert.equal(stockOf(tables, 'S'), 10, 'no stock deducted');
}

// 5) Sold-out / zero-qty variants are skipped; nothing chosen → clear error
{
  const { call, row, tables } = await load(base());
  const res = await call('adminPushStockToShop', 'L', [{ parentRowIndex: row('V'), childQty: { [row('V3')]: 0, [row('V1')]: 0 } }]);
  assert.equal(res.status, 'Error');
  assert.equal(listItems(tables).length, 0);
}

console.log('Stock import checks passed.');
