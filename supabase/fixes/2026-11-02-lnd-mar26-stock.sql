-- LND Mar26 MD stock: one product per item, characters as options.
-- Before: most items were separate stock products per character
-- ("LND Mar26 MD เซ็ตรูปฟิล์ม (เซน)", "... (ไซรัส)", ...). After: one product
-- ("LND Mar26 MD เซ็ตรูปฟิล์ม") whose options are the characters, each keeping
-- its own barcode, stock and photo. Also: main products have no barcode/stock of
-- their own, "เซเวียร์" → "ซาเวียร์", เข็มกลัด S ไซรัส ฿340 → ฿130, deposits as in
-- the order list. Nothing else in stock is touched. All or nothing.
begin;

-- Turn one group of single items into options of a new main product.
-- p_codes: the items' barcodes; the option name is the character in "(...)" or after " - ".
create or replace function pg_temp.lnd_group(p_name text, p_price numeric, p_deposit numeric, p_codes text[])
returns void language plpgsql as $$
declare v_parent uuid; v_found int;
begin
  select count(*) into v_found from public.stock_items where code = any(p_codes) and parent_id is null;
  if v_found <> cardinality(p_codes) then
    raise exception '% : expected % items, found % (already fixed or changed?)', p_name, cardinality(p_codes), v_found;
  end if;
  insert into public.stock_items(parent_id, code, name, image, price, deposit, yuan, stock, status)
  select null, '', p_name, s.image, p_price, p_deposit, 0, null, 'Open'
    from public.stock_items s where s.code = p_codes[1]
  returning id into v_parent;
  update public.stock_items s
     set parent_id = v_parent,
         name = btrim(coalesce(substring(s.name from '\(([^)]*)\)\s*$'), substring(s.name from ' - (.+)$'), s.name)),
         price = p_price, deposit = p_deposit
   where s.code = any(p_codes) and s.parent_id is null;
end $$;

select pg_temp.lnd_group('LND Mar26 MD แฟ้มคดี',          390, 100, array['6979089338646','6979089338622','6979089338639']);
select pg_temp.lnd_group('LND Mar26 MD เข็มกลัด',          130,  30, array['6979089338592','6979089338578']);
select pg_temp.lnd_group('LND Mar26 MD เซ็ตรูปฟิล์ม',      130,  30, array['6979089339001','6979089338974','6979089338998','6979089338967','6979089338981']);
select pg_temp.lnd_group('LND Mar26 MD โฟโต้การ์ด',        140,  30, array['6979089338691','6979089338684','6979089338677','6979089338707','6979089338660']);
select pg_temp.lnd_group('LND Mar26 MD เข็มกลัด S',        130,  30, array['6979089339056','6979089339025','6979089339049']);
select pg_temp.lnd_group('LND Mar26 MD สแตนดี้ R',         340, 100, array['6979089338776','6979089338769','6979089338790']);
select pg_temp.lnd_group('LND Mar26 MD สแตนดี้ B',         340, 100, array['6979089338929']);
select pg_temp.lnd_group('LND Mar26 MD เข็มกลัด B',        130,  30, array['6979089338820']);
select pg_temp.lnd_group('LND Mar26 MD ภาพฉาก B',          270, 100, array['6979089338875']);
select pg_temp.lnd_group('LND Mar26 MD เซ็ตช้อน+ตะเกียบ',  240, 100, array['6979089339094']);

-- โชกเกอร์ / โปสเตอร์ already have options: fix only their main product
-- (name without "(เซน)", no barcode or stock of its own — the เซน option has them)
update public.stock_items set name = 'LND Mar26 MD โชกเกอร์', code = '', stock = null
 where id = '29ecdb24-0b72-4d44-a45f-d89727c10078' and parent_id is null;
update public.stock_items set name = 'LND Mar26 MD โปสเตอร์', code = '', stock = null
 where id = '96a65ee3-54b4-45d2-b2a4-e01b3f6d1e7d' and parent_id is null;

-- Spelling used in the order list
update public.stock_items set name = 'ซาเวียร์' where code = '6979089338660';

commit;
