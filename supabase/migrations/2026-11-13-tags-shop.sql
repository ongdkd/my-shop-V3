-- Tags, part 2: the shop page filters products by tag, and admin can mark words
-- that are not tags ("ซองดำ", "Stage Ver.") so they stop showing as unknown.
-- Safe to run more than once.

-- 1. A sixth kind, 'skip': words to ignore
alter table public.tag_terms drop constraint if exists tag_terms_kind_check;
alter table public.tag_terms add constraint tag_terms_kind_check
  check (kind in ('series','char','type','brand','sale','skip'));

-- 2. Customers may read the dictionary (it only holds product words); changing
--    it stays admin-only through tag_terms_admin_all
grant select on public.tag_terms to anon, authenticated;
drop policy if exists tag_terms_public_read on public.tag_terms;
create policy tag_terms_public_read on public.tag_terms
  for select to anon, authenticated using (true);
