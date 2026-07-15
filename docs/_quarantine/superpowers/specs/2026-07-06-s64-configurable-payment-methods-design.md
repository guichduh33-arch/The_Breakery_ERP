# S64 — Moyens de paiement configurables + fix I-1 voids même-jour (design)

> **Date :** 2026-07-06 · **Session :** S64 (`swarm/session-64`, base `674b639` = master post-#152)
> **Sources :** fiche 19 D2.1 (`docs/workplan/remise-a-plat/19-settings-configuration.md`) — ferme B1.1c/B1.7 ; fiche 03 (E. dépendances) ; INDEX S63 finding I-1 (décision propriétaire actée 2026-07-06 : fixer les 2 RPCs).
> **Règle money-path :** RESPECTÉE — v17/v11/fire_v4/`_record_sale_stock_v1` intouchés. Chantier A = config + UI + lecture ; chantier B = 2 RPCs de **lecture pure**.

## Chantier A — `enabled_payment_methods`

### A.1 Problème
Les 6 méthodes de paiement sont codées en dur au POS (`apps/pos/src/features/payment/components/paymentMethods.ts:13-20` + copie locale `split/PerPayerMethodStep.tsx:41-48`). Le scénario doc « désactiver la carte en un clic, effet immédiat sur toutes les caisses » (B1.7) est impossible ; la tuile hub « Payment Methods » est « (Soon) » (`SettingsHubPage.tsx:47`).

### A.2 Décisions de design
1. **Stockage** : colonne `business_config.enabled_payment_methods JSONB NOT NULL DEFAULT '["cash","card","qris","edc","transfer","store_credit"]'::jsonb` + `CHECK (jsonb_typeof(enabled_payment_methods) = 'array' AND jsonb_array_length(enabled_payment_methods) > 0)`. Défaut = tout activé → **zéro changement de comportement au déploiement**.
2. **RPCs settings** (migration `20260710000115`, corps repris des **corps live** via `pg_get_functiondef` — leçon DEV-S57-02, jamais depuis le fichier de migration) :
   - `get_settings_by_category_v1` : nouvelle catégorie `'payments'` → `jsonb_build_object('enabled_payment_methods', v_row.enabled_payment_methods)`.
   - `set_setting_v1` : nouveau `WHEN 'enabled_payment_methods'` avant le `ELSE` — validations : `jsonb_typeof = 'array'` (`setting_type_invalid`), longueur ≥ 1 (`setting_value_invalid` — on ne peut pas tout désactiver), chaque élément est une string ∈ {cash, card, qris, edc, transfer, store_credit} (`setting_value_invalid` + DETAIL nommant l'élément), pas de doublon. Audit `audit_logs` old/new hérité du corps existant (aucun code neuf).
   - Trio S20 (REVOKE PUBLIC + anon, GRANT authenticated) répété à l'identique.
3. **BO** : nouvelle page `apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx` — miroir du pattern `SettingsInventoryPage.tsx` (draft/dirty/save, gates `settings.read`/`settings.update`) : 6 cases à cocher (libellés de `paymentMethods.ts`), garde client « au moins une méthode », une écriture `set_setting_v1` (clé unique). `useSettings.ts` : étendre `SettingsCategory` avec `'payments'`. Route lazy `/backoffice/settings/payment-methods` + tuile hub activée (retirer « (Soon) »).
4. **POS** : nouveau hook `apps/pos/src/features/settings/hooks/useEnabledPaymentMethods.ts` — miroir du pattern `useTaxRate.ts` (SELECT direct `business_config.enabled_payment_methods` sous le JWT PIN) :
   - retourne `Set<PaymentMethod>` ; **fail-open** = les 6 méthodes pendant le chargement ou sur erreur/valeur invalide (une panne de config ne bloque JAMAIS un encaissement — miroir du dégradé `DEFAULT_TAX_RATE`) ;
   - « effet immédiat » v1 = `staleTime 30 s` + `refetchInterval 60 s` + `refetchOnWindowFocus` (la fiche accepte « au minimum un refetch on-focus » ; canal realtime = amélioration future).
5. **Filtrage** : `PaymentMethodGrid.tsx` et `PerPayerMethodStep.tsx` appellent le hook et filtrent leur liste `METHODS` (le doublon de tableau reste — libellés voulus différents `Store Credit`/`Store` ; seul le filtre est partagé). **Garde de désélection** : si la méthode sélectionnée (`selectedMethod` / `payer.method` draft non confirmé) sort de la liste activée, elle est désélectionnée au render suivant.
6. **HORS PÉRIMÈTRE (assumé, dette)** : l'EF `process-payment` conserve sa whitelist des 6 (`index.ts:52`) — l'activation est **UI-level v1** ; un client malveillant/stale peut encore soumettre une méthode désactivée. L'enforcement serveur toucherait la money-path (EF) → session future si le propriétaire le demande.

### A.3 Tests
- **pgTAP `supabase/tests/payment_methods_config.test.sql`** (live, BEGIN/ROLLBACK via MCP) : défaut = 6 méthodes ; set valide (sous-ensemble) relu via `get_settings_by_category_v1('payments')` ; rejets — array vide, élément inconnu, non-array, doublon (tous `22023`) ; `42501` sans `settings.update` ; ligne `audit_logs` `setting.update` avec `metadata.old/new` ; ACL anon (pas d'EXECUTE).
- **BO smoke** `SettingsPaymentMethodsPage.smoke.test.tsx` (miroir de la suite inventory) : rendu, garde ≥ 1, save déclenche le RPC.
- **POS unit** : hook fail-open (erreur → 6 méthodes) ; `PaymentMethodGrid` masque une méthode désactivée ; garde de désélection.

## Chantier B — Fix I-1 : voids même-jour (décision propriétaire actée)

### B.1 Problème (INDEX S63)
Le lineage void (`20260704000018`) pose `status='voided'` ET insère un refund `is_full_void=true` : la commande sort du brut ET son refund est soustrait → une vente 50k payée puis voidée le même jour compte **−50k au lieu de 0** dans `revenue_today`/`revenue_30d` (`get_dashboard_overview_v1`) et dans `get_daily_sales_v1` (biais partagé verbatim depuis S40, miroir mandaté par la spec S63 §3.2).

### B.2 Fix (migration `20260710000116`)
`AND NOT r.is_full_void` (versions live : vérifier l'alias/le nom exact de colonne sur les corps `pg_get_functiondef` **et** le schéma `refunds` avant d'écrire) dans les CTEs/sous-requêtes refunds des **deux** RPCs, réécrits **in-place** depuis leurs corps live. Sémantique résultante : « net » = brut des commandes valides − refunds **partiels** ; un full-void est neutre (déjà exclu du brut). Signatures inchangées → `[types-noop]`.

### B.3 Tests (pins pgTAP)
Nouvelle suite `supabase/tests/net_revenue_full_void.test.sql` (delta-based, DB non vide — pattern S63) :
1. commande payée aujourd'hui puis **full void** (refund `is_full_void=true`) ⇒ delta net = 0 dans les DEUX RPCs (pas −montant) ;
2. commande payée + refund **partiel** (`is_full_void=false`) ⇒ delta net = total − refund partiel dans les deux ;
3. non-régression : les exclusions S63 (voided hors brut) tiennent.

## Critères de sortie
- Migrations `_115`/`_116` appliquées cloud (MCP), types regénérés (+`payments` category visible ; `_116` `[types-noop]`).
- pgTAP `payment_methods_config` + `net_revenue_full_void` verts live ; suites BO/POS vertes ; suite monorepo verte.
- Une méthode décochée au BO disparaît de `PaymentMethodGrid` ET de `PerPayerMethodStep` en ≤ 60 s sans reload.
- Fiches 19/03 + 00-INDEX + CLAUDE.md mis à jour ; I-1 fermé dans l'INDEX S63 (renvoi S64).
