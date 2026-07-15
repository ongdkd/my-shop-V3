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

const api = await readFile(new URL('../js/api.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../js/admin.js', import.meta.url), 'utf8');
const config = await readFile(new URL('../js/config.js', import.meta.url), 'utf8');
assert.ok(api.includes('function spreadsheetIdFromUrl(url)'), 'Google Sheet URLs must be parsed safely');
assert.ok(api.includes('function fetchGoogleSpreadsheet(spreadsheetId)'), 'official Google Sheets API import must be enabled');
assert.ok(api.includes("['ranges', 'Products']"), 'legacy product range must be requested');
assert.ok(api.includes("['ranges', 'Orders']"), 'legacy order range must be requested');
assert.ok(api.includes('var importName = spreadsheet.title'), 'import name must come from spreadsheet metadata');
assert.ok(config.includes('window.GOOGLE_SHEETS_API_KEY'), 'Google Sheets API key setting must exist');
assert.ok(api.includes("sb.rpc('import_legacy_order_list'"), 'legacy imports must use the atomic database transaction');
assert.ok(schema.includes('create or replace function public.import_legacy_order_list'), 'legacy import RPC must exist');
assert.ok(schema.includes("notify pgrst, 'reload schema'"), 'schema changes must refresh the PostgREST cache');
assert.ok(schema.includes('source_stock_item_id uuid'), 'shop products must retain their warehouse source');
assert.ok(schema.includes('products_source_stock_item_fk'), 'warehouse links must use a database foreign key');
assert.ok(schema.includes('on delete set null'), 'deleting a warehouse item must preserve shop products');
assert.ok(api.includes('adminSyncStockProductToLinked'), 'warehouse edits must support syncing linked shop products');
assert.ok(api.includes(".eq('source_stock_item_id', parentId)"), 'warehouse sync must target stable source IDs');
assert.ok(api.includes('source_stock_item_id: p.id'), 'new warehouse imports must create the stable link');
assert.ok(admin.includes('appendLinkedProductSyncOption'), 'warehouse edit dialogs must expose the sync checkbox');
assert.ok(admin.includes('function defaultStockImportQty(product)'), 'finite warehouse stock must be the default import quantity');
assert.ok(admin.includes('_stockQtyMap[p.rowIndex] = defaultStockImportQty(p)'), 'stock cards must start with the maximum finite quantity');
const warehouseSync = api.slice(
  api.indexOf('adminSyncStockProductToLinked'),
  api.indexOf('adminAppendStockChild', api.indexOf('adminSyncStockProductToLinked'))
);
assert.ok(!warehouseSync.includes('remaining:'), 'warehouse catalog sync must not overwrite per-list stock');

console.log('Project safety checks passed.');
