// Runs supabase/schema.sql on an in-process Postgres (PGlite) and checks that the
// warehouse count follows shipping:  npm run test:db
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
  create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
  create or replace function auth.role() returns text language sql as $$ select 'anon' $$;
`);
try { await db.exec(schema); await db.exec(schema); }
catch (e) { console.error('SCHEMA FAILED:', e.message); process.exit(1); }

const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => Object.values((await q(sql, p))[0])[0];
const [{ id: L }] = await q(`insert into public.order_lists(name, status, display) values ('Test','Open','Show') returning id`);
// Warehouse: a single item, and an item with a counted and an unlimited variant
const [{ id: S }] = await q(`insert into public.stock_items(code, name, stock) values ('s1','Card pack',10) returning id`);
const [{ id: P }] = await q(`insert into public.stock_items(code, name, stock) values ('p1','Badge',null) returning id`);
const [{ id: K1 }] = await q(`insert into public.stock_items(parent_id, code, name, stock) values ($1,'c1','Red',5) returning id`, [P]);
await q(`insert into public.stock_items(parent_id, code, name, stock) values ($1,'','Blue',null)`, [P]);
// The round: both moved in from the warehouse, plus a pre-order product that is not
await q(`insert into public.products(list_id, code, name, price, remaining, status, options, option_details, source_stock_item_id) values
  ($1,'A','Card pack',160,4,'Open','','[]'::jsonb,$2),
  ($1,'B','Badge',60,null,'Open','Red:c1,Blue','[{"name":"Red","code":"c1","remaining":3},{"name":"Blue","code":"","remaining":null}]'::jsonb,$3),
  ($1,'C','Pre-order doll',900,null,'Open','','[]'::jsonb,null)`, [L, S, P]);
const stock = (id) => one(`select stock from public.stock_items where id=$1`, [id]).then(Number);
const reserved = async (id) => Number((await one(`select public.stock_reserved()`))[id] || 0);
const add = (product, qty, remark = '0812345678') =>
  one(`insert into public.orders(list_id, customer, product, qty, remark) values ($1,'@t',$2,$3,$4) returning id`, [L, product, qty, remark]);
const ship = (id, on = true) => q(`update public.orders set shipped_at = ${on ? 'now()' : 'null'} where id=$1`, [id]);

// 1) Moved into a round = reserved, still on the shelf
assert.equal(await stock(S), 10); assert.equal(await reserved(S), 4); assert.equal(await reserved(K1), 3);

// 2) A customer orders 2 through the shop: the shelf is unchanged, the 2 stay reserved
const r = await one(`select public.submit_order($1,'@a','0812345678',$2::jsonb, gen_random_uuid())`, [L, JSON.stringify([{ id: 'A', quantity: 2, isDeposit: false }])]);
assert.equal(r.status, 'Success', r.message);
assert.equal(await stock(S), 10); assert.equal(await reserved(S), 4);
const o1 = await one(`select id from public.orders where customer='@a'`);

// 3) Shipped → off the shelf and no longer reserved; un-shipped → back
await ship(o1); assert.equal(await stock(S), 8); assert.equal(await reserved(S), 2);
await ship(o1, false); assert.equal(await stock(S), 10);
await ship(o1); assert.equal(await stock(S), 8);
// Changing something else on a shipped order does not count it again
await q(`update public.orders set tracking='WB123456789TH', status='' where id=$1`, [o1]); assert.equal(await stock(S), 8);

// 4) A variant goes to its own warehouse row; an unlimited variant has no number to change
const o2 = await add('Badge (Red)', 1); await ship(o2); assert.equal(await stock(K1), 4);
const o3 = await add('Badge (Blue)', 2); await ship(o3); assert.equal(await stock(K1), 4);

// 5) A POS sale is handed over on the spot
await add('Card pack', 1, 'POS'); assert.equal(await stock(S), 7);

// 6) A product that did not come from the warehouse changes nothing
const o4 = await add('Pre-order doll', 3); await ship(o4);
assert.equal(await stock(S), 7); assert.equal(await stock(K1), 4);

// 7) Shipping more than the count says is there stops at zero instead of failing
const o5 = await add('Card pack', 99); await ship(o5); assert.equal(await stock(S), 0);

// 8) The one-time correction ran once and left its record
assert.equal(Number(await one(`select count(*) from public.app_settings where key='stock_on_shelf'`)), 1);

// 9) The correction itself: reserved pieces go back into the count, once
const migration = fs.readFileSync(new URL('../supabase/migrations/2026-11-16b-ship-stock.sql', import.meta.url), 'utf8');
await q(`update public.stock_items set stock = 5 where id=$1`, [S]);
await q(`delete from public.app_settings where key='stock_on_shelf'`);
const held = await reserved(S); assert.ok(held > 0);
await db.exec(migration); assert.equal(await stock(S), 5 + held);
await db.exec(migration); assert.equal(await stock(S), 5 + held);

console.log('Stock-on-shipping checks passed.');
