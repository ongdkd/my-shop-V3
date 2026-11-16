// Runs supabase/schema.sql on an in-process Postgres (PGlite) and checks that
// customer_submit_payment only takes slips the verify-slip function has checked:
// paid to the shop, at least what is owed, dated after the order or bill.
//   npm run test:db
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
try { await db.exec(schema); } catch (e) { console.error('SCHEMA FAILED:', e.message); process.exit(1); }

const q = async (sql, p) => (await db.query(sql, p)).rows;
const [{ id: L }] = await q(`insert into public.order_lists(name, status, display) values ('Slip','Open','Show') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'A','Card pack',160,50,40,null,'Open','','[]'::jsonb)`, [L]);
const IMG = 'data:image/png;base64,AAAA';
const order = async (cust, qty, dep) => {
  const [{ r }] = await q(`select public.submit_order($1, $2, '0812345678', $3::jsonb, gen_random_uuid()) as r`,
    [L, cust, JSON.stringify([{ id: 'A', quantity: qty, isDeposit: dep }])]);
  assert.equal(r.status, 'Success', r.message);
};
const checked = (ref, amount, ok = true, ago = '0 minutes') => q(
  `insert into public.slip_checks(bank_ref, amount, paid_at, receiver_ok) values ($1, $2, now() - $3::interval, $4)`, [ref, amount, ago, ok]);
const pay = async (cust, ref, amount = 1, bill = null, address = '') => {
  try {
    const [{ r }] = await q(`select public.customer_submit_payment($1, $2, $3, now(), $4, $5, $6, $7) as r`, [cust, L, amount, ref, address, IMG + ref, bill]);
    return r;
  } catch (e) { return { error: e.message }; }
};

assert.equal((await q(`select value->>'on' v from public.app_settings where key='slip_verify'`))[0].v, 'true', 'the check is on');

// Order: 2 × ฿160 = ฿320 owed
await order('@V', 2, false);
assert.match((await pay('@V', 'REF0000001')).error, /ยังไม่ผ่านการตรวจ/, 'a slip never checked is refused');
await checked('REF0000002', 300);
assert.match((await pay('@V', 'REF0000002')).error, /น้อยกว่ายอดที่ต้องโอน ฿320\.00/, 'too little');
await checked('REF0000003', 400, false);
assert.match((await pay('@V', 'REF0000003')).error, /ไม่ได้โอนเข้าบัญชีของร้าน/, 'paid to someone else');
await checked('REF0000004', 400, true, '3 days');
assert.match((await pay('@V', 'REF0000004')).error, /ก่อนวันที่สั่งซื้อ/, 'an old slip');
await checked('REF0000005', 350);
let r = await pay('@V', 'REF0000005', 1);
assert.equal(r.ok, true, r.error);
const [p] = await q(`select amount::float8 a from public.payments where bank_ref='REF0000005'`);
assert.equal(p.a, 350, 'the bank amount is saved, not what the browser sent');
await checked('REF0000006', 100);
assert.match((await pay('@V', 'REF0000006')).error, /ชำระครบแล้ว/, 'nothing left to pay');
r = await pay('@V', 'REF0000005', 1, null, 'new address');
assert.equal(r.addressUpdated, true, 'the same slip still updates the address');

// Bill: deposit ฿50 paid when ordering; the bill asks the rest ฿110 + fee ฿40 = ฿150
await order('@W', 1, true);
await checked('REF0000007', 50);
assert.equal((await pay('@W', 'REF0000007')).ok, true);
const [{ id: B }] = await q(`insert into public.deliveries(customer, fee, sent_at) values (public.norm_customer('@W'), 40, now()) returning id`);
await q(`update public.orders set delivery_id=$1 where list_id=$2 and customer='@W'`, [B, L]);
await checked('REF0000008', 140);
assert.match((await pay('@W', 'REF0000008', 1, B)).error, /฿150\.00/, 'bill: rest + fee');
await checked('REF0000009', 150);
assert.equal((await pay('@W', 'REF0000009', 1, B)).ok, true);

// Switched off: slips go through as before
await q(`update public.app_settings set value='{"on": false}' where key='slip_verify'`);
await order('@X', 1, false);
assert.equal((await pay('@X', 'REF0000010', 160)).ok, true, 'off = no check');

console.log('Slip check passed.');
