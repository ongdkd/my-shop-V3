-- Product discounts: price_before keeps the normal price while a product is on
-- discount; price stays what customers pay (orders, POS and totals use it as before).
-- NULL = not on discount. Run once in the Supabase SQL Editor.
alter table public.products
  add column if not exists price_before numeric;
