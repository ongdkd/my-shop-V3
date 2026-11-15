-- Only the shop edits orders now: customers can no longer remove items themselves.
-- The function stays (nothing calls it), but nobody outside the database may run it.
revoke all on function public.customer_remove_items(text, text, uuid, uuid[]) from public, anon, authenticated;
