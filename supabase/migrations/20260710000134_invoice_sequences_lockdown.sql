-- 20260710000134_invoice_sequences_lockdown.sql
-- S68 — Correctif revue DB (Critical #2) : invoice_sequences est écrite UNIQUEMENT par
-- _next_b2b_invoice_number_v1 (SECURITY DEFINER, owner postgres → bypass RLS). Le REVOKE de
-- _129 n'a couvert que PUBLIC/anon ; le filet S20 (ALTER DEFAULT PRIVILEGES) ne révoque
-- pas `authenticated` sur les TABLES → authenticated gardait GRANT ALL (SELECT/INSERT/
-- UPDATE/DELETE), permettant à tout utilisateur connecté de manipuler la séquence via
-- PostgREST et de casser la continuité / provoquer des collisions d'invoice_number.
-- Miroir de b2b_settings (_20260623000010) et discount_authorizations (_085) : REVOKE
-- authenticated + ENABLE RLS sans policy (accès RPC-only).

REVOKE ALL ON TABLE public.invoice_sequences FROM authenticated;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;
