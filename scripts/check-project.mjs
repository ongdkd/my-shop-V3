import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const storefront = await readFile(new URL('../js/index.js', import.meta.url), 'utf8');

assert.ok(schema.includes('public.is_admin()'), 'RLS must use the explicit admin check');
assert.ok(!schema.includes('for all to authenticated using (true)'), 'authenticated users must not automatically be admins');
assert.ok(schema.includes("coalesce(it->>'quantity', '') !~ '^[1-9][0-9]*$'"), 'order quantities must be positive integers');
assert.ok(schema.includes('group by item.value->>\'id\''), 'duplicate order items must be aggregated for stock validation');
assert.ok(schema.includes('products_list_code_uidx'), 'product codes must be unique per list');
assert.ok(storefront.includes('function escapeHtml(value)'), 'storefront must escape values rendered as HTML');
assert.ok(storefront.includes('el.textContent = String(text'), 'toast messages must render as text');

console.log('Project safety checks passed.');
