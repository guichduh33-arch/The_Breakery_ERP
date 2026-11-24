-- ADR-047 — Équipements achetés et amortissement automatique : le schéma.
--
-- Ce fichier pose les objets ; les fonctions vivent dans 20261125000002 à
-- 20261125000004, la reprise de la machine de production dans 20261125000005.
--
-- Choix techniques :
-- * Le registre est la table fixed_assets : une fiche par article. Une dépense
--   marquée « équipement » pour N articles crée N fiches à l'approbation.
-- * Le compte d'équipement, la durée et la dotation mensuelle sont figés sur la
--   fiche à sa création : un remapping ultérieur ne change pas un plan en cours.
-- * fixed_asset_depreciations garde une ligne par équipement et par mois :
--   « posted » (écriture passée, immuable) ou « refused » (période fermée,
--   signalée, retentée à sa propre date tant que la période peut rouvrir).
--   L'unicité (asset_id, period_month) interdit deux dotations pour un mois.
-- * Aucun accès direct du client : lecture par les RPC du registre, sous
--   reports.statements.read (ADR-039 décision 2). RLS activée, garde PIN commune.
-- * Les groupes fiscaux et les types sont des enums Postgres : le front lit
--   leurs valeurs dans les types générés, jamais dans un littéral.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.fixed_asset_type AS ENUM ('equipment', 'production_machine');
COMMENT ON TYPE public.fixed_asset_type IS
  'ADR-047 : equipment = 1600 équipement et mobilier ; production_machine = 1610 machines de production.';

CREATE TYPE public.fixed_asset_tax_group AS ENUM ('group_1', 'group_2');
COMMENT ON TYPE public.fixed_asset_tax_group IS
  'ADR-047 décision 5 : groupes fiscaux UU PPh art. 11, linéaire. group_1 = 48 mois, group_2 = 96 mois.';

CREATE TYPE public.fixed_asset_origin AS ENUM ('expense', 'opening');
CREATE TYPE public.fixed_asset_status AS ENUM ('active', 'disposed');
CREATE TYPE public.fixed_asset_disposal_reason AS ENUM ('sale', 'breakage', 'scrap');
CREATE TYPE public.fixed_asset_depreciation_status AS ENUM ('posted', 'refused');

-- ---------------------------------------------------------------------------
-- Comptes et mappings
-- ---------------------------------------------------------------------------
-- La charte n'avait pas de compte pour la perte de sortie (ADR-047,
-- conséquences). Charge hors caisse : section opérationnelle, comme 6950.
INSERT INTO public.accounts (code, name, account_class, account_type, balance_type,
                             is_postable, is_system, is_active, cash_flow_section)
VALUES ('6970', 'Loss on disposal of fixed assets', 6, 'expense', 'debit',
        true, true, true, 'operating')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.accounting_mappings (mapping_key, account_code, description, is_active) VALUES
  ('FIXED_ASSET_EQUIPMENT',                '1600', 'Equipment & furniture asset account (ADR-047)', true),
  ('FIXED_ASSET_PRODUCTION_MACHINE',       '1610', 'Production machinery asset account (ADR-047)', true),
  ('FIXED_ASSET_ACCUMULATED_DEPRECIATION', '1690', 'Accumulated depreciation (ADR-047)', true),
  ('FIXED_ASSET_DEPRECIATION_EXPENSE',     '6950', 'Monthly depreciation expense (ADR-047)', true),
  ('FIXED_ASSET_DISPOSAL_GAIN',            '4950', 'Gain on fixed asset disposal (ADR-047)', true),
  ('FIXED_ASSET_DISPOSAL_LOSS',            '6970', 'Loss on fixed asset disposal (ADR-047)', true)
ON CONFLICT (mapping_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Permission d'écriture du registre
-- ---------------------------------------------------------------------------
-- La lecture suit reports.statements.read (ADR-047 décision 9). Inscrire un
-- équipement déjà au bilan et sortir un équipement écrivent dans les comptes :
-- permission propre, donnée au propriétaire seul, délégable depuis les rôles.
INSERT INTO public.permissions (code, module, action, description)
VALUES ('accounting.fixed_assets.manage', 'accounting', 'fixed_assets.manage',
        'Register existing fixed assets and dispose of fixed assets (manager PIN for disposal)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_code, permission_code, is_granted)
VALUES ('SUPER_ADMIN', 'accounting.fixed_assets.manage', true)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Types d'écriture
-- ---------------------------------------------------------------------------
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check CHECK (
  reference_type IS NULL OR reference_type = ANY (ARRAY[
    'sale', 'sale_void', 'sale_refund', 'purchase', 'purchase_return', 'purchase_payment',
    'expense', 'expense_payment', 'shift_close', 'adjustment', 'waste', 'opname',
    'production', 'transfer', 'manual', 'pos_outstanding', 'pos_outstanding_payment',
    'stock_movement', 'void', 'refund', 'cash_movement', 'b2b_order', 'b2b_payment',
    'b2b_adjustment', 'b2b_order_cancel', 'year_close', 'store_credit_grant',
    'store_credit_conversion', 'store_credit_expiry', 'customer_advance_receipt',
    'customer_advance_application',
    'fixed_asset_depreciation', 'fixed_asset_disposal'
  ]::text[])
);

-- ---------------------------------------------------------------------------
-- Marque « équipement » sur la dépense
-- ---------------------------------------------------------------------------
ALTER TABLE public.expenses
  ADD COLUMN asset_type      public.fixed_asset_type,
  ADD COLUMN asset_tax_group public.fixed_asset_tax_group,
  ADD COLUMN asset_name      text,
  ADD COLUMN asset_quantity  smallint,
  ADD CONSTRAINT expenses_asset_mark_complete CHECK (
    (asset_type IS NULL AND asset_tax_group IS NULL AND asset_name IS NULL AND asset_quantity IS NULL)
    OR (asset_type IS NOT NULL AND asset_tax_group IS NOT NULL
        AND length(btrim(asset_name)) BETWEEN 2 AND 120
        AND asset_quantity BETWEEN 1 AND 50)
  );
COMMENT ON COLUMN public.expenses.asset_type IS
  'ADR-047 : non NULL = achat d''équipement. À l''approbation, le débit va au compte du type et les fiches du registre naissent.';
COMMENT ON COLUMN public.expenses.asset_quantity IS
  'ADR-047 décision 1 : nombre d''articles identiques. Le seuil de 2 000 000 IDR TTC se juge par article.';

-- ---------------------------------------------------------------------------
-- Registre
-- ---------------------------------------------------------------------------
CREATE SEQUENCE public.fixed_asset_number_seq;

CREATE TABLE public.fixed_assets (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_number               text NOT NULL UNIQUE,
  name                       text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  asset_type                 public.fixed_asset_type NOT NULL,
  tax_group                  public.fixed_asset_tax_group NOT NULL,
  useful_life_months         smallint NOT NULL CHECK (useful_life_months > 0),
  asset_account_id           uuid NOT NULL REFERENCES public.accounts(id),
  in_service_date            date NOT NULL,
  cost                       numeric(15,2) NOT NULL CHECK (cost > 0),
  monthly_depreciation       numeric(15,2) NOT NULL CHECK (monthly_depreciation >= 0),
  origin                     public.fixed_asset_origin NOT NULL,
  expense_id                 uuid REFERENCES public.expenses(id) ON DELETE RESTRICT,
  expense_unit_index         smallint,
  opening_accumulated        numeric(15,2) NOT NULL DEFAULT 0,
  opening_accumulated_as_of  date,
  depreciation_start_month   date NOT NULL,
  status                     public.fixed_asset_status NOT NULL DEFAULT 'active',
  disposed_at                date,
  disposal_reason            public.fixed_asset_disposal_reason,
  disposal_price             numeric(15,2),
  disposal_proceeds_account_id uuid REFERENCES public.accounts(id),
  disposal_notes             text CHECK (length(disposal_notes) <= 500),
  disposal_je_id             uuid REFERENCES public.journal_entries(id),
  disposed_by                uuid REFERENCES public.user_profiles(id),
  idempotency_key            uuid UNIQUE,
  created_by                 uuid REFERENCES public.user_profiles(id),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_start_month_first_day
    CHECK (depreciation_start_month = date_trunc('month', depreciation_start_month)::date),
  CONSTRAINT fixed_assets_opening_bounds
    CHECK (opening_accumulated >= 0 AND opening_accumulated <= cost),
  CONSTRAINT fixed_assets_origin_shape CHECK (
    (origin = 'expense' AND expense_id IS NOT NULL AND expense_unit_index IS NOT NULL
       AND opening_accumulated = 0 AND opening_accumulated_as_of IS NULL)
    OR (origin = 'opening' AND expense_id IS NULL AND expense_unit_index IS NULL
       AND opening_accumulated_as_of IS NOT NULL)
  ),
  CONSTRAINT fixed_assets_disposal_shape CHECK (
    (status = 'active' AND disposed_at IS NULL AND disposal_reason IS NULL
       AND disposal_price IS NULL AND disposal_proceeds_account_id IS NULL AND disposal_je_id IS NULL)
    OR (status = 'disposed' AND disposed_at IS NOT NULL AND disposal_reason IS NOT NULL
       AND disposal_je_id IS NOT NULL AND disposed_by IS NOT NULL
       AND ((disposal_reason = 'sale' AND disposal_price > 0 AND disposal_proceeds_account_id IS NOT NULL)
         OR (disposal_reason <> 'sale' AND disposal_price IS NULL AND disposal_proceeds_account_id IS NULL)))
  ),
  CONSTRAINT fixed_assets_expense_unit_unique UNIQUE (expense_id, expense_unit_index)
);
CREATE INDEX fixed_assets_status_idx ON public.fixed_assets (status);

COMMENT ON TABLE public.fixed_assets IS
  'ADR-047 : registre des équipements. Écrit uniquement par les RPC du registre et par l''approbation d''une dépense marquée équipement.';

CREATE TABLE public.fixed_asset_depreciations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  period_month    date NOT NULL CHECK (period_month = date_trunc('month', period_month)::date),
  entry_date      date NOT NULL,
  month_index     smallint NOT NULL CHECK (month_index > 0),
  amount          numeric(15,2) NOT NULL CHECK (amount > 0),
  status          public.fixed_asset_depreciation_status NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  refused_reason  text,
  attempts        integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_asset_depreciations_one_per_month UNIQUE (asset_id, period_month),
  CONSTRAINT fixed_asset_depreciations_shape CHECK (
    (status = 'posted' AND journal_entry_id IS NOT NULL AND refused_reason IS NULL)
    OR (status = 'refused' AND journal_entry_id IS NULL AND refused_reason IS NOT NULL)
  )
);

COMMENT ON TABLE public.fixed_asset_depreciations IS
  'ADR-047 : une dotation par équipement et par mois. posted = écriture passée (immuable) ; refused = période fermée, signalée, jamais reportée sur un autre mois.';

-- ---------------------------------------------------------------------------
-- Gardes : fiche figée, dotation passée immuable
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._guard_fixed_asset_frozen_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'fixed_asset_delete_forbidden' USING ERRCODE = '42501';
  END IF;
  IF (NEW.cost, NEW.in_service_date, NEW.tax_group, NEW.useful_life_months,
      NEW.asset_account_id, NEW.monthly_depreciation, NEW.opening_accumulated,
      NEW.opening_accumulated_as_of, NEW.depreciation_start_month, NEW.origin,
      NEW.expense_id, NEW.asset_type)
     IS DISTINCT FROM
     (OLD.cost, OLD.in_service_date, OLD.tax_group, OLD.useful_life_months,
      OLD.asset_account_id, OLD.monthly_depreciation, OLD.opening_accumulated,
      OLD.opening_accumulated_as_of, OLD.depreciation_start_month, OLD.origin,
      OLD.expense_id, OLD.asset_type)
     AND EXISTS (SELECT 1 FROM public.fixed_asset_depreciations d
                  WHERE d.asset_id = OLD.id AND d.status = 'posted') THEN
    RAISE EXCEPTION 'fixed_asset_frozen' USING ERRCODE = '22023';
  END IF;
  IF OLD.status = 'disposed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'fixed_asset_disposed' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE TRIGGER fixed_assets_frozen_guard
  BEFORE UPDATE OR DELETE ON public.fixed_assets
  FOR EACH ROW EXECUTE FUNCTION public._guard_fixed_asset_frozen_v1();

CREATE FUNCTION public._guard_fixed_asset_depreciation_posted_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'fixed_asset_depreciation_posted_immutable' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE TRIGGER fixed_asset_depreciations_posted_guard
  BEFORE UPDATE OR DELETE ON public.fixed_asset_depreciations
  FOR EACH ROW EXECUTE FUNCTION public._guard_fixed_asset_depreciation_posted_v1();

REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_frozen_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_frozen_v1() FROM anon;
REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_frozen_v1() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_depreciation_posted_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_depreciation_posted_v1() FROM anon;
REVOKE EXECUTE ON FUNCTION public._guard_fixed_asset_depreciation_posted_v1() FROM authenticated;

-- ---------------------------------------------------------------------------
-- Droits et RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_asset_depreciations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fixed_assets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fixed_asset_depreciations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.fixed_asset_number_seq FROM PUBLIC, anon, authenticated;

-- Aucun GRANT client : la lecture passe par get_fixed_assets_v1 /
-- get_fixed_asset_v1. Les politiques ci-dessous bornent quand même un accès
-- direct si un GRANT était un jour ajouté.
CREATE POLICY fixed_assets_statements_read ON public.fixed_assets
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'reports.statements.read'));
CREATE POLICY fixed_asset_depreciations_statements_read ON public.fixed_asset_depreciations
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'reports.statements.read'));
CREATE POLICY pin_session_required ON public.fixed_assets AS RESTRICTIVE
  FOR ALL TO authenticated USING (public.request_has_active_pin_session_v1())
  WITH CHECK (public.request_has_active_pin_session_v1());
CREATE POLICY pin_session_required ON public.fixed_asset_depreciations AS RESTRICTIVE
  FOR ALL TO authenticated USING (public.request_has_active_pin_session_v1())
  WITH CHECK (public.request_has_active_pin_session_v1());
