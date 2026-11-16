-- LND Mar26 MD: link the round's products to the warehouse items of the same name,
-- so shipping an order takes its piece off the warehouse count (the variant with
-- the character's name) and unshipped orders show as reserved.
-- APPLIED 2026-11-16 through the admin page (10 products); kept as the record.
-- Not linked: โพลาลอยด์, กำไล, จาน, ชาม (no warehouse item) and the free-gift product.
-- Safe to run again: only products that are not linked yet are touched.
update public.products p
   set source_stock_item_id = s.id
  from public.stock_items s, public.order_lists l
 where l.id = p.list_id and l.name = 'Love and Deepspace Mar26 MD'
   and p.source_stock_item_id is null
   and s.parent_id is null
   and lower(regexp_replace(s.name, '\s+', '', 'g')) = lower(regexp_replace(p.name, '\s+', '', 'g'))
   and exists (select 1 from public.stock_items k where k.parent_id = s.id);
