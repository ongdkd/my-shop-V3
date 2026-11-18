// Runs supabase/schema.sql on an in-process Postgres (PGlite) and checks gifts per bill:
// orders add up until a slip pays them, then the customer's next order starts a new bill
// with its own gift count; only an admin can add items to an earlier bill.   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
  .replace('create extension if not exists pgcrypto;', '-- (pgcrypto skipped: gen_random_uuid is built in)');
const db = new PGlite();
await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.jwt() returns jsonb language sql as $$
    select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
  create or replace function auth.role() returns text language sql as $$ select 'authenticated' $$;
`);
try { await db.exec(schema); } catch (e) { console.error('SCHEMA FAILED:', e.message); process.exit(1); }

const q = async (sql, p) => (await db.query(sql, p)).rows;
const as = (email) => q(`select set_config('test.jwt', $1, false)`, [email ? JSON.stringify({ email }) : '']);
const [{ id: L }] = await q(`insert into public.order_lists(name, status, display) values ('Shutline','Open','Show') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'A','Card',100,0,40,null,'Open','','[]'::jsonb)`, [L]);
// one Sticker for every ¥66 (every: true)
await q(`update public.order_lists set gift_rules=$2::jsonb, gift_mode='all' where id=$1`,
  [L, JSON.stringify([{ id: 'g', name: 'Sticker', min: 66, currency: 'CNY', every: true, stock: null }])]);

const C = '@harshbrown2709';
const order = async (n, cust = C) => {
  const [{ r }] = await q(`select public.submit_order($1, $2, '0812345678', $3::jsonb, gen_random_uuid()) as r`,
    [L, cust, JSON.stringify([{ id: 'A', quantity: n, isDeposit: false }])]);
  assert.equal(r.status, 'Success', r.message);
  return r;
};
const bills = async () => (await q(`select bill_no, sum(qty) filter (where pay_type <> 'Gift')::int as cards,
    coalesce(sum(qty) filter (where pay_type = 'Gift'), 0)::int as gifts
  from public.orders where list_id = $1 and public.norm_customer(customer) = 'harshbrown2709'
  group by bill_no order by bill_no`, [L])).map((r) => [r.bill_no, r.cards, r.gifts]);
const pay = (amount) => q(`insert into public.payments(list_id, customer, amount, paid_at) values ($1, $2, $3, now())`, [L, C, amount]);

await as('');
// 1) before paying, a second order adds up: ¥40 + ¥40 = ¥80 → 1 sticker, all on bill 1
await order(1);
assert.deepEqual(await bills(), [[1, 1, 0]]);
await order(1);
assert.deepEqual(await bills(), [[1, 2, 1]]);

// 2) the slip pays bill 1 → the next order starts bill 2 with its own count
await pay(200);
await order(1);                                                   // ¥40 alone: no sticker yet
assert.deepEqual(await bills(), [[1, 2, 1], [2, 1, 0]]);
await order(1);                                                   // bill 2 reaches ¥80 → its own sticker
assert.deepEqual(await bills(), [[1, 2, 1], [2, 2, 1]]);

// 3) the shop marking a bill paid closes it too (no slip needed)
const [{ id: L2 }] = await q(`insert into public.order_lists(name, status, display) values ('Other','Open','Show') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'A','Card',100,0,40,null,'Open','','[]'::jsonb)`, [L2]);
await q(`select public.submit_order($1, '@mia', '0812345678', '[{"id":"A","quantity":1}]'::jsonb, gen_random_uuid())`, [L2]);
await q(`update public.orders set status = 'ชำระแล้ว' where list_id = $1`, [L2]);
await q(`select public.submit_order($1, '@mia', '0812345678', '[{"id":"A","quantity":1}]'::jsonb, gen_random_uuid())`, [L2]);
assert.deepEqual((await q(`select bill_no from public.orders where list_id=$1 order by seq`, [L2])).map((r) => r.bill_no), [1, 2]);

// 4) customers can't add to an old bill: the admin switch is ignored for them, and a closed
//    round stays closed
await q(`update public.order_lists set status = 'Closed' where id = $1`, [L]);
const [{ r: notAdmin }] = await q(`select public.admin_add_items($1, $2, 1, '[{"id":"A","quantity":1}]'::jsonb) as r`, [L, C]);
assert.equal(notAdmin.status, 'Error');
const [{ r: sneaky }] = await q(`select set_config('app.admin_bill', '1', false), public.submit_order($1, $2, '0812345678', '[{"id":"A","quantity":1}]'::jsonb, gen_random_uuid()) as r`, [L, C]);
assert.equal(sneaky.status, 'Error');                             // still "Order list is not open"
await q(`select set_config('app.admin_bill', '', false)`);

// 5) admin adds 1 card to bill 1 (round closed): bill 1 reaches ¥120 → 1 sticker (¥66 each),
//    so no new one; adding 2 more → ¥200 → 3 stickers; the customer owes the new cards + bill 2
await as('admin@kagashop.admin');
let [{ r: add }] = await q(`select public.admin_add_items($1, $2, 1, '[{"id":"A","quantity":1}]'::jsonb) as r`, [L, 'HarshBrown2709']);
assert.equal(add.status, 'Success', add.message);
assert.deepEqual(await bills(), [[1, 3, 1], [2, 2, 1]]);
[{ r: add }] = await q(`select public.admin_add_items($1, $2, 1, '[{"id":"A","quantity":2}]'::jsonb) as r`, [L, C]);
assert.deepEqual(await bills(), [[1, 5, 3], [2, 2, 1]]);
assert.deepEqual(add.gifts, ['Sticker ×2']);
assert.equal(Number(add.added), 200);
assert.equal(Number(add.owed), 500);                              // ฿700 ordered − ฿200 paid
assert.equal(add.customer, C);                                     // keeps the customer's own spelling

// 6) removing items takes back only that bill's unshipped extra gifts
await as('');
const extra = await q(`select id from public.orders where list_id=$1 and bill_no=1 and pay_type<>'Gift' order by seq desc limit 2`, [L]);
await q(`delete from public.orders where id = any($1::uuid[])`, [extra.map((r) => r.id)]);
await q(`select public.sync_gifts($1, $2, '0812345678', null, true, true)`, [L, C]);
assert.deepEqual(await bills(), [[1, 2, 1], [2, 2, 1]]);                       // 3 cards gone: ¥80 → 1 sticker; bill 2 untouched
console.log('check-gift-bills: ok');
