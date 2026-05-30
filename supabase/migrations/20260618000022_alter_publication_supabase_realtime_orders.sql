-- 20260618000022_alter_publication_supabase_realtime_orders.sql
-- Session 33 / Wave 1.9 — enable realtime on orders for OrdersListPage live updates.

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
