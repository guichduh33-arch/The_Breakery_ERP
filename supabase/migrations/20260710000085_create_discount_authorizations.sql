-- 20260710000085_create_discount_authorizations.sql
-- S55 P1.5 (audit T7) : nonce single-use adossé à la vérification EF du PIN
-- discount. Le nonce ne sort jamais du serveur : process-payment le mint
-- (service_role) et appelle complete_order_with_payment_v16 dans la même
-- requête → TTL court. v16 (SECURITY DEFINER) le consomme atomiquement.
-- (Prévu _084 au plan ; décalé _085 — _084 consommée par le fix revoke reversal.)
CREATE TABLE public.discount_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_profile_id UUID NOT NULL REFERENCES user_profiles(id),
  scope              TEXT NOT NULL DEFAULT 'discount' CHECK (scope = 'discount'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 seconds',
  consumed_at        TIMESTAMPTZ,
  consumed_order_id  UUID
);
COMMENT ON TABLE public.discount_authorizations IS
  'S55 T7 — single-use discount-PIN authorization nonces minted by the process-payment EF (service_role) and consumed by complete_order_with_payment_v16. Never client-visible.';
ALTER TABLE public.discount_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_authorizations FROM PUBLIC;
REVOKE ALL ON public.discount_authorizations FROM anon;
REVOKE ALL ON public.discount_authorizations FROM authenticated;
GRANT ALL ON public.discount_authorizations TO service_role;
