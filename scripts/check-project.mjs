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
assert.ok(schema.includes("option_details jsonb not null default '[]'::jsonb"), 'products must persist per-option images and stock');
assert.ok(api.includes('option_details: kids.map'), 'warehouse imports must preserve each option\'s metadata');
assert.ok(admin.includes('appendLinkedProductSyncOption'), 'warehouse edit dialogs must expose the sync checkbox');
assert.ok(admin.includes('function defaultStockImportQty(product)'), 'finite warehouse stock must be the default import quantity');
assert.ok(admin.includes('_stockQtyMap[p.rowIndex] = defaultStockImportQty(p)'), 'stock cards must start with the maximum finite quantity');
const warehouseSync = api.slice(
  api.indexOf('adminSyncStockProductToLinked'),
  api.indexOf('adminAppendStockChild', api.indexOf('adminSyncStockProductToLinked'))
);
assert.ok(!warehouseSync.includes('remaining:'), 'warehouse catalog sync must not overwrite per-list stock');

const posPage = await readFile(new URL('../pos.html', import.meta.url), 'utf8');
const loginPage = await readFile(new URL('../admin-login.html', import.meta.url), 'utf8');
const storefrontPage = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const pos = await readFile(new URL('../js/pos.js', import.meta.url), 'utf8');

assert.ok(schema.includes('Deposit not available for'), 'submit_order must reject zero/negative deposits server-side');
assert.ok(storefront.includes('Number(product.deposit) > 0'), 'storefront must never build a zero-deposit cart line');
assert.ok(schema.includes("split_part(v_opt, ':', 1)"), 'order labels must strip option barcodes');
assert.ok(schema.includes("split_part(allowed.value, ':', 1)"), 'submit_order must accept option display names');
assert.ok(storefront.includes('function optLabel('), 'storefront must display option names without barcodes');
assert.ok(storefront.includes('function customerNameError('), 'storefront must enforce the @ customer-name rule');
assert.ok(storefront.includes('function confirmDiscardCart('), 'leaving with a filled cart must ask for confirmation');
assert.ok(storefront.includes('aria-pressed'), 'variant chips must expose their selected state');
assert.ok(storefront.includes('role="button" tabindex="0"'), 'hub cards must be keyboard accessible');
assert.ok(posPage.includes("location.replace('admin-login.html')"), 'unauthenticated POS access must redirect to login');
assert.ok(!pos.includes('ORDER_HUB|'), 'POS must not render a fake non-payable QR payload');
assert.ok(pos.includes('function getOptionDetail(product, optionName)'), 'POS must resolve selected option metadata');
assert.ok(pos.includes('optionLeft = Number(detail.remaining)'), 'POS must enforce selected option stock');
assert.ok(pos.includes('getProductImage(item.product, item.option)'), 'POS summary must use the selected option image');
assert.ok(schema.match(/Stock not enough for[^\n]+req\.option_name/g)?.length >= 2, 'web and POS RPCs must enforce option stock');
assert.ok(!loginPage.includes('tabindex="-1"'), 'password toggle must stay in keyboard tab order');
assert.ok(storefrontPage.includes('ตรวจสอบคำสั่งซื้อ'), 'cart button must say review, not confirm');

console.log('Project safety checks passed.');
