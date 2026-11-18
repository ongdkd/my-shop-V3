// Runs supabase/schema.sql on an in-process Postgres (PGlite) and checks staff roles:
// "admin" logins can do everything, "pos" logins can only sell and read what POS shows,
// and nobody else gets in.   npm run test:db
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
  -- the signed-in login comes from a test setting
  create or replace function auth.jwt() returns jsonb language sql as $$
    select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
  create or replace function auth.role() returns text language sql as $$ select 'authenticated' $$;
`);
try { await db.exec(schema); } catch (e) { console.error('SCHEMA FAILED:', e.message); process.exit(1); }

const q = async (sql, p) => (await db.query(sql, p)).rows;
const as = (email) => q(`select set_config('test.jwt', $1, false)`, [email ? JSON.stringify({ email }) : '']);
const one = async (sql, p) => Object.values((await q(sql, p))[0])[0];

await q(`insert into public.staff_roles(email, role) values ('staff@kagashop.admin','pos'), ('boss2@kagashop.admin','admin')`);
const [{ id: L }] = await q(`insert into public.order_lists(name, status, display) values ('Closed round','Closed','Hidden') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'A','Card',100,0,0,5,'Closed','','[]'::jsonb)`, [L]);
// a second round the staff login is NOT given (open and public, to show the round rule still holds)
const [{ id: L2 }] = await q(`insert into public.order_lists(name, status, display) values ('Other round','Open','Show') returning id`);
await q(`insert into public.products(list_id, code, name, price, deposit, yuan, remaining, status, options, option_details)
         values ($1,'B','Badge',50,0,0,5,'Open','','[]'::jsonb)`, [L2]);
await q(`insert into public.staff_rounds(email, list_id) values ('staff@kagashop.admin', $1)`, [L]);

// who is what
for (const [email, admin, pos, role] of [
  ['admin@kagashop.admin', true, true, 'admin'],   // the original allowlist
  ['boss2@kagashop.admin', true, true, 'admin'],   // admin by role
  ['staff@kagashop.admin', false, true, 'pos'],
  ['STAFF@kagashop.admin', false, true, 'pos'],    // case doesn't matter
  ['random@gmail.com', false, false, null],
  ['', false, false, null],                        // signed out
]) {
  await as(email);
  assert.equal(await one(`select public.is_admin()`), admin, email + ' admin');
  assert.equal(await one(`select public.is_pos_staff()`), pos, email + ' pos');
  assert.equal(await one(`select public.my_role()`), role, email + ' role');
}

// selling: POS staff can, outsiders can't (even on a closed, hidden round)
const sell = async (email, list = L, code = 'A') => {
  await as(email);
  return one(`select public.submit_pos_sale($1, $2::jsonb, gen_random_uuid())`, [list, JSON.stringify([{ id: code, quantity: 1 }])]);
};
assert.equal((await sell('random@gmail.com')).status, 'Error');
assert.equal((await sell('')).status, 'Error');
const ok = await sell('staff@kagashop.admin');
assert.equal(ok.status, 'Success', JSON.stringify(ok));
assert.equal(await one(`select remaining::int from public.products where list_id=$1`, [L]), 4);  // stock taken
assert.equal(await one(`select count(*)::int from public.orders where remark='POS'`), 1);
assert.equal((await sell('admin@kagashop.admin')).status, 'Success');
assert.equal((await sell('staff@kagashop.admin', L2, 'B')).status, 'Error');                // not their round
assert.equal(await one(`select remaining::int from public.products where list_id=$1`, [L2]), 5); // nothing taken
assert.equal((await sell('admin@kagashop.admin', L2, 'B')).status, 'Success');              // admins: every round
await as('staff@kagashop.admin');
assert.deepEqual(await one(`select public.my_pos_lists()`), [L]);
await as('admin@kagashop.admin');
assert.equal(await one(`select public.my_pos_lists()`), null);

// the database's own rules (row level security), as a signed-in browser would see them
const rls = async (email, sql, p) => {
  await as(email);
  await db.exec('set role authenticated');
  try { return await q(sql, p); } finally { await db.exec('reset role'); }
};
await q(`insert into public.orders(list_id, customer, product, qty, remark) values ($1, '@web', 'Card', 1, '')`, [L]);
await db.exec(`grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;`); // Supabase gives these by default
const staffProducts = await rls('staff@kagashop.admin', `select list_id from public.products`);
assert.ok(staffProducts.some((r) => r.list_id === L));                                                 // their closed round: yes
assert.equal((await rls('staff@kagashop.admin', `select id from public.order_lists where id = $1`, [L])).length, 1);
assert.equal((await rls('staff@kagashop.admin', `select id from public.orders where list_id = $1`, [L2])).length, 0); // other round's sales: no
assert.equal((await rls('staff@kagashop.admin', `select remark from public.orders`)).every((r) => r.remark === 'POS'), true); // POS sales only
assert.equal((await rls('staff@kagashop.admin', `select email from public.staff_roles`)).length, 0);  // can't see the team
assert.equal((await rls('staff@kagashop.admin', `update public.products set price = 1 returning id`)).length, 0);  // can't edit
assert.equal((await rls('staff@kagashop.admin', `delete from public.orders returning id`)).length, 0);           // can't delete
await assert.rejects(rls('staff@kagashop.admin', `insert into public.staff_roles(email, role) values ('me@x.y','admin')`)); // can't promote itself
assert.equal((await rls('admin@kagashop.admin', `select remark from public.orders`)).length, 4);       // admin sees everything
assert.equal((await rls('admin@kagashop.admin', `select email from public.staff_roles`)).length, 2);
assert.equal((await rls('random@gmail.com', `select id from public.products where list_id = $1`, [L])).length, 0); // closed round hidden from others
await assert.rejects(rls('staff@kagashop.admin', `insert into public.staff_rounds(email, list_id) values ('staff@kagashop.admin', $1)`, [L2])); // can't give itself rounds
await q(`delete from public.staff_roles where email = 'staff@kagashop.admin'`);
assert.equal(await one(`select count(*)::int from public.staff_rounds`), 0);                          // rounds go with the login
console.log('check-staff-roles: ok');
