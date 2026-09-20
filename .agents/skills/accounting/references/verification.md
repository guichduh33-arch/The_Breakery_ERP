# accounting — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist (avant de toucher le module)
- Sources de vérité
- Verification before claiming a fix is complete
- When to escalate

## Audit checklist (avant de toucher le module)

- [ ] **JE balanced** — pour tout `journal_entries` : `Σ journal_entry_lines.debit =
  Σ credit` (colonnes `debit`/`credit`). Divergence = trigger bogué ou INSERT direct.
- [ ] **Mapping existe + postable** — `resolve_mapping_account(key)` lève `P0002` si key
  absente OU compte inactif : vérifier `accounts.is_active` avant de conclure.
- [ ] **Fiscal guard fail-closed** — `check_fiscal_period_open` appelé par chaque
  émetteur, périodes de l'année courante seedées.
- [ ] **1151 reste inactif** — `update_account_active` refuse sa réactivation
  (`account_1151_reserved_non_pkp`) ; contourner = violation ADR-005.
- [ ] **Dédup sale_void/refund** préservée dans les TROIS : `get_profit_loss`,
  `get_balance_sheet`, `close_fiscal_year`.
- [ ] **Cash flow réconcilié** au centime — sinon un compte est mal classé en
  `cash_flow_section`.
- [ ] **PPN foldé, pas de ligne 1151** — `_emit_expense_je` DR la charge TTC ; toute
  fonction routant vers 1151 = régression NON-PKP.
- [ ] **REVOKE pair complet** sur toute nouvelle RPC (PUBLIC + anon + default
  privileges) ; une `SECURITY DEFINER` sans `has_permission` est lisible par tout
  compte authentifié — un `PermissionGate` de route n'est pas une protection.

## Sources de vérité

```
ADR
  docs/adr/005-juridiction-fiscale-lombok-pbjt.md   # ACTUEL — Lombok/NTB, PBJT (supersedes ADR-003)
  docs/adr/003-pkp-status-non-pkp.md                # historique — NON-PKP rationale
  docs/adr/013-comptabilite-integrite-void-refund-remise.md
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md

Références du skill
  references/coa-benchmark-fnb.md            # benchmark COA F&B même taille + méthode d'écart
  references/fiscal-optimization-nonpkp.md   # leviers fiscaux légaux, cadre indonésien

Migrations   supabase/migrations/*cash_flow*, *fiscal*, *journal*, *pb1*, *cash_wallet*, *account*
Tests pgTAP  supabase/tests/ : accounting · close_fiscal_year · fiscal_guard_fail_closed
             pb1_dedup_void_refund · pb1_split_helper · ledger_appendonly_and_balance
             update_account_active · cash_wallets · cash_register · s26_db_hardening
AGENTS.md    patterns canoniques du projet
```

## Verification before claiming a fix is complete

```bash
pnpm typecheck
pnpm --filter @breakery/app-backoffice test accounting
# pgTAP via MCP execute_sql (BEGIN/ROLLBACK) — lancer les fichiers touchés.
# RPC modifiée → types regen OBLIGATOIRE (MCP generate_typescript_types).
```

> Les suites BO ont des échecs pré-existants env-gated (`VITE_SUPABASE_URL Required`)
> sans `apps/backoffice/.env.local`. Comparer au run sur `master` avant de conclure à
> une régression.

## When to escalate

- **Taux PB1 ou `tax_inclusive`** (`business_config`) → décision business owner.
- **Réactiver 1151, router vers 2142/2143/4190** → violation ADR-005 / doublon — nouvel
  ADR requis.
- **Verrouiller une période, clôturer une année** → irréversible, confirmer avec l'owner.
- **Choix de régime fiscal (UMKM final vs réel), statut juridique, seuils PKP** →
  décision Mamat + conseil fiscal local ; le skill chiffre, il ne tranche pas.
- **Nouveau moyen de paiement** sans mise à jour de `_sale_payment_mapping_key` → il
  tombe en caisse en silence ; l'enum et le helper bougent ensemble.
- **Bump d'une RPC cockpit** → `_vN+1` + DROP `_vN` même migration + REVOKE pair +
  types regen + pgTAP.
