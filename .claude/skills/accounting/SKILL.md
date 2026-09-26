---
name: accounting
description: >-
  Comptabilité Breakery : écritures, COA, PBJT NON-PKP, périodes, clôture, grand livre, bilan, cash flow et coffres. Pour vérifier ou modifier un flux comptable, ou préparer un conseil fiscal légal. Exports : reports-exports.
---

# Accounting — senior master accountant, The Breakery ERP

Distinguer mécanique comptable, lecture de rapport et conseil. Lire les émetteurs concernés avant toute modification de JE ; lire la méthode advisory seulement pour une demande de conseil.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Mental model NON-PKP (ADR-003 ratifié 2026-05-20, juridiction corrigée par ADR-005 le 2026-07-16)

**The Breakery est NON-PKP.** Décision irrévocable — relire
`docs/adr/005-juridiction-fiscale-lombok-pbjt.md` (supersedes ADR-003) avant tout
changement fiscal.

- **Output tax** : **taxe F&B locale 10%** — **PBJT Makanan dan Minuman** (UU HKPD
  1/2022), niveau kabupaten/kota, perçue par le **Bapenda** de la commune (The Breakery
  est à **Lombok, NTB** — pas Bali, cf. ADR-005). « PB1 » reste le label usuel dans le
  code. Pas de PPN sortant, pas d'e-Faktur, pas d'export DJP.
- **Input tax** : PPN 11% fournisseurs PKP **non-récupérable** → **folded** dans le coût
  d'acquisition (achats de stock → `INVENTORY_GENERAL` 1141) ou dans la charge (dépenses
  → compte de catégorie). Le compte `1151 VAT Input` est **désactivé** et sa réactivation
  refusée par la RPC. Ne jamais chercher à le rouvrir sans un nouvel ADR supersedant
  ADR-005.
- **PB1 est INCLUSIVE** : `business_config.tax_inclusive = true`, `tax_rate = 0.1`
  (relevé 2026-08-17). Le prix affiché est TTC ; la taxe se dé-cumule
  (`total × rate / (1 + rate)`) via le helper `_pb1_split`, seul endroit qui connaît la
  formule. Ne jamais recalculer une PB1 à la main — appeler le helper ou lire
  `orders.tax_amount` déjà splité.
- **`current_pb1_rate()`** lit `business_config.tax_rate`. Toujours l'utiliser — pas de
  hardcode `10/110`.
- **`calculate_pb1_payable`** : `pb1_payable = pb1_output` (pas de soustraction
  `vat_input`). Gatée `reports.financial.read` depuis le bump v2 du 2026-08-18
  (qui corrige aussi le résidu ADR-005 : `tax_regime` renvoie
  `NON_PKP_LOMBOK_PBJT`, plus `NON_PKP_BALI_PB1`). `get_pb1_report` est la
  variante mensuelle, même gate.

---

## Preventive checklists

**Avant de modifier un trigger/émetteur JE** : mappings présents + comptes actifs ·
`current_pb1_rate()`/`_pb1_split` (pas de hardcode) · idempotence préservée ·
`check_fiscal_period_open` appelé · vente et reversal partagent
`_sale_payment_mapping_key` (ADR-013 D3) · pgTAP happy path + période fermée + balanced.

**Avant d'ajouter/modifier un compte COA** : `cash_flow_section` explicite dans l'INSERT ·
`is_postable=false` sur les synthétiques · classe = type économique (1 asset, 2 liab,
3 equity, 4 revenue, 5 cogs, 6 opex) · désactivation via `update_account_active`
uniquement · jamais de DROP d'un compte avec lignes historiques.

**Avant de toucher la clôture** : états `open` → `closed` → `locked` (irréversible,
aucun RPC de déverrouillage) · la clôture annuelle seede N+1 · sa garde anti-rejeu ne
repose PAS sur l'index d'idempotence.

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
