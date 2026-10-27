// Runs supabase/schema.sql on an in-process Postgres (PGlite) and checks the
// free-gift logic inside submit_order. Needs the dev dependency:
//   npm install && npm run test:db
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  .replace('create extension if not exists pgcrypto;', '-- (pgcrypto skipped: gen_random_uuid is built in)');
const db = new PGlite();

// Minimal stand-ins for what Supabase provides
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
  create or replace function auth.role() returns text language sql as $$ select 'anon' $$;
`);
try { await db.exec(schema); await db.exec(schema); /* re-running on a live DB must be safe */ }
catch (e) { console.error('SCHEMA FAILED:', e.message); process.exit(1); }

const q = async (sql, p) => (await db.query(sql, p)).rows;
const [{ id: L }] = await q(`insert into public.order_lists(name, status, display) values ('Test','Open','Show') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'A','Card pack',160,50,40,null,'Open','','[]'::jsonb),
                ($1,'B','Badge',60,0,15,null,'Open','','[]'::jsonb)`, [L]);
const setRules = (rules, mode) => q(`update public.order_lists set gift_rules=$2::jsonb, gift_mode=$3 where id=$1`, [L, JSON.stringify(rules), mode]);
const order = async (items, phone = '0812345678') => {
  const [{ r }] = await q(`select public.submit_order($1, '@t', $2, $3::jsonb, gen_random_uuid()) as r`, [L, phone, JSON.stringify(items)]);
  return r;
};
const giftRows = () => q(`select product from public.orders where list_id=$1 and pay_type='Gift' order by seq`, [L]);
const stockOf = async (i) => (await q(`select gift_rules->$2::int->>'stock' as s from public.order_lists where id=$1`, [L, i]))[0].s;

const rules = [
  { id: 'g1', name: 'Sticker', min: 188, currency: 'CNY', stock: null },
  { id: 'g2', name: 'Poster', min: 288, currency: 'CNY', stock: 2 },
  { id: 'g3', name: 'Keyring', min: 500, currency: 'THB', stock: 1 }
];

// 1) 'all': ¥40×5 = ¥200 → Sticker; ฿800 ≥ ฿500 → Keyring too
await setRules(rules, 'all');
let r = await order([{ id: 'A', quantity: 5, isDeposit: false }]);
assert.equal(r.status, 'Success', r.message);
assert.deepEqual(r.gifts, ['Sticker', 'Keyring']);
assert.equal(await stockOf(2), '0', 'Keyring stock counted down');

// 2) Below every threshold → no gifts
r = await order([{ id: 'B', quantity: 1, isDeposit: false }]);
assert.deepEqual(r.gifts, []);

// 3) ¥40×8 = ¥320 → Sticker + Poster; Keyring is out of stock now (฿1280 would qualify)
r = await order([{ id: 'A', quantity: 8, isDeposit: false }]);
assert.deepEqual(r.gifts, ['Sticker', 'Poster']);
assert.equal(await stockOf(1), '1');

// 4) 'best': only the last reached rule in list order; sold-out rules are skipped
await setRules(rules.map((g) => g.id === 'g2' ? { ...g, stock: 1 } : g), 'best'); // Sticker ∞, Poster 1, Keyring 1
r = await order([{ id: 'A', quantity: 8, isDeposit: false }]);
assert.deepEqual(r.gifts, ['Keyring'], 'best = last reached rule in list order (฿1280 ≥ ฿500)');
assert.equal(await stockOf(2), '0');
r = await order([{ id: 'A', quantity: 8, isDeposit: false }]);
assert.deepEqual(r.gifts, ['Poster'], 'Keyring sold out → next reached rule');
assert.equal(await stockOf(1), '0');
r = await order([{ id: 'A', quantity: 8, isDeposit: false }]);
assert.deepEqual(r.gifts, ['Sticker'], 'Poster sold out too → Sticker');
r = await order([{ id: 'A', quantity: 1, isDeposit: false }]);
assert.deepEqual(r.gifts, [], 'best mode still needs a threshold to be reached');

// 5) Deposit still counts the full value of the goods
await setRules([{ id: 'g4', name: 'Bag', min: 300, currency: 'THB', stock: null }], 'all');
r = await order([{ id: 'A', quantity: 2, isDeposit: true }]); // ฿320 full, ฿100 paid
assert.deepEqual(r.gifts, ['Bag']);

// 6) Gift rows are recorded on the order for packing, at ฿0
const rows = await giftRows();
assert.ok(rows.length >= 6 && rows.every((x) => x.product.startsWith('ของแถม: ')));
const [{ s }] = await q(`select coalesce(sum(total),0) as s from public.orders where pay_type='Gift'`);
assert.equal(Number(s), 0);

// 7) Broken rule data is ignored instead of failing the checkout
await setRules([{ name: 'Bad', min: 'abc', currency: 'CNY' }, { name: '', min: 1 }, { name: 'Neg', min: 1, stock: -1 }], 'all');
r = await order([{ id: 'A', quantity: 1, isDeposit: false }]);
assert.equal(r.status, 'Success'); assert.deepEqual(r.gifts, []);

// 8) A list with no gift rules behaves exactly as before
await setRules([], 'all');
r = await order([{ id: 'B', quantity: 1, isDeposit: false }]);
assert.equal(r.status, 'Success'); assert.deepEqual(r.gifts, []);

console.log('Gift checks passed (schema.sql on Postgres).');

// Backups: a snapshot holds every table, and only the newest 30 are kept
for (let i = 0; i < 32; i++) await q(`select public.take_backup()`);
const snaps = await q(`select summary, data from public.backups order by id`);
assert.equal(snaps.length, 30);
const last = snaps[29];
assert.equal(last.summary.orders, (await q(`select count(*)::int n from public.orders`))[0].n);
assert.equal(last.data.order_lists[0].name, 'Test');
console.log('Backup checks passed.');
