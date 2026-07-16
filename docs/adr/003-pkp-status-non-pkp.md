# ADR-003 — Statut PKP The Breakery : NON-PKP

> **Date** : 2026-05-20
> **Statut** : remplacé par ADR-005 (juridiction fiscale corrigée : Lombok/NTB, PBJT municipale — le cœur NON-PKP est repris tel quel)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Contexte** : audit intégral V3 (F-S26-AC-08), ouverture session S26 Comptable Cockpit
> **Supersedes** : —

---

## 1. Contexte

L'audit intégral V3 du 2026-05-20 a identifié une ambiguïté fiscale critique dans le code accounting actuel :

- Le code S13 (mai 2026) a câblé un workflow **PKP par défaut** :
  - Mapping key `PURCHASE_VAT_INPUT` → compte `1151 VAT Input` (asset)
  - Trigger `create_purchase_journal_entry` émet `DR PURCHASE_VAT_INPUT (vat_amount)` sur chaque goods receipt
  - RPC `calculate_vat_payable(period)` calcule `vat_payable = vat_output - vat_input` (formule PKP classique)
- Le code accounting des ventes utilise `SALE_PB1_TAX` → compte `2110 PB1 Payable` (output) et applique `tax_rate = 0.10` (PB1 10%)

Cette divergence implicite (PKP côté input + non-PKP côté output) est silencieusement **inconsistante** :

1. Soit The Breakery est PKP → il devrait facturer PPN 11% en output (et non PB1 10%) + émettre e-Faktur sortants ;
2. Soit The Breakery est non-PKP → le PPN 11% input fournisseur ne peut **PAS** être réclamé comme crédit TVA, et le compte `1151 VAT Input` est une **fiction comptable** (asset qui ne se réalisera jamais en cash refund DJP).

Le propriétaire a tranché le statut fiscal réel le **2026-05-20** en réponse au scope S26.

---

## 2. Décision

**The Breakery est NON-PKP.**

- **Output tax** : **PB1 10%** sur toutes les ventes (taxe régionale F&B Bali, gérée par PEMDA — pas la DJP centrale).
- **Input tax** : certains fournisseurs sont PKP et facturent PPN 11% (taux Indonésie depuis 2025). The Breakery étant non-PKP, ce PPN **ne peut PAS être réclamé** comme crédit de TVA et doit être **capitalisé dans le coût d'acquisition** des biens reçus.

### Conséquences comptables (SAK EMKM non-PKP)

1. **Goods receipt JE** : émettre `DR INVENTORY_GENERAL (subtotal + vat_amount)` au lieu de `DR INVENTORY (subtotal) + DR PURCHASE_VAT_INPUT (vat_amount)`. Le PPN supplier devient partie intégrante du coût d'acquisition → WAC reflète le vrai cost.
2. **Compte 1151 VAT Input** : désactivé (`is_active = false`) avec note "réservé si statut PKP change un jour". **Ne pas DROP** (history JE existante préservée).
3. **`calculate_vat_payable`** : renommé en **`calculate_pb1_payable_v1`** avec formule simplifiée `pb1_payable = pb1_output`. Plus de soustraction `vat_input`.
4. **Pages BO** : `VATManagementPage` renommée **`PB1ManagementPage`** (rapport mensuel PEMDA Bali, pas DJP central).
5. **Features fiscales centrales (DJP) NON applicables** :
   - ❌ e-Faktur sortant (output PPN)
   - ❌ e-Bupot (retenues PPh)
   - ❌ Export DJP XML pour PPN
   - ✅ Rapport PB1 mensuel PEMDA Bali (PDF + CSV)

---

## 3. Alternatives considérées

### Alternative A — Statut PKP

- **Avantages** : crédit TVA récupérable sur PPN input, capacité à servir clients B2B PKP qui demandent e-Faktur sortant.
- **Inconvénients** :
  - Switch coûte du dev (e-Faktur, e-Bupot, DJP XML, VAT Output workflow complet)
  - Output passe de PB1 10% à PPN 11% → augmentation de 1% du prix facturé client (impact compétitivité boulangerie Bali)
  - Compliance ongoing PKP (rapports mensuels DJP, audits)
- **Verdict** : rejeté — la majorité du CA est B2C cash boulangerie, pas B2B PKP.

### Alternative B — Statut hybride (input PKP, output PB1) — *status quo code S13*

- **Avantages** : conserver le crédit TVA sur les achats.
- **Inconvénients** :
  - **Illégal en Indonésie** : on ne peut pas réclamer un crédit TVA sans être PKP. Le compte `1151 VAT Input` accumulé serait sans valeur cash.
  - Balance Sheet sur-affiche un asset qui ne se réalisera jamais → distorsion comptable.
  - PB1 dû au PEMDA mensuel est sous-estimé si on a soustrait `vat_input` (formule `calculate_vat_payable` actuelle).
- **Verdict** : rejeté — incohérent fiscalement et juridiquement.

### Alternative C — Statut NON-PKP (retenue) — *ADR-003 final*

- **Avantages** :
  - Conforme statut fiscal réel
  - Simplifie l'accounting (pas de e-Faktur, pas d'export DJP)
  - WAC précis (PPN supplier folded dans inventory cost)
  - PB1 reporting clair (mensuel PEMDA Bali)
- **Inconvénients** :
  - Cost prices augmentent de ~11% sur les inputs des suppliers PKP (mais reflète le vrai coût)
  - 2-3 jours dev S26 pour migrer le code S13 (option B « start clean » sans rejouage historique car V3 jamais déployée en prod)
- **Verdict** : retenu.

---

## 4. Conséquences implémentation (S26)

### Wave 1 DB hardening — phases dédiées

- **1.C** — Refactor `create_purchase_journal_entry_trigger` : fold `vat_amount` dans `INVENTORY_GENERAL` (1130), retire le `DR PURCHASE_VAT_INPUT`.
- **1.D** — Bump `calculate_pb1_payable_v1` + DROP `calculate_vat_payable(date, date)` dans la même migration.
- **1.H** — `UPDATE accounts SET is_active = false, notes = 'NON-PKP : réservé si statut change' WHERE code = '1151'`.

### Wave 3 UI — renommage

- Route `/accounting/vat-management` → `/accounting/pb1-management`
- Composant `VATManagementPage` → `PB1ManagementPage`
- Sidebar label : "VAT / PPN" → "PB1 Bali"

### Pas de rejouage historique (option B)

Le code S13 a tourné depuis mai 2026 sur le V3 dev cloud, mais V3 **n'a jamais été déployée en prod** (cf. mémoire `v2-not-in-production`). Le rejouage des JE historiques pour fold le PPN dans inventory n'apporte aucune valeur business — option B « start clean from S26 » ratifiée.

---

## 5. Révision

À ré-évaluer si :

- The Breakery franchit le seuil PKP (CA > **IDR 4.8 milliards / an** = ~USD 320k — non atteint en boulangerie mono-site Bali).
- Expansion vers la fourniture B2B de boulangeries PKP qui exigent e-Faktur sortant.
- Réforme fiscale Indonésie qui change le régime des restaurants/cafés F&B.

Si révision : créer ADR-005 supersedes ADR-003 + plan de migration accounting (re-activate 1151, refactor triggers, ajouter e-Faktur).

---

## 6. Références

- Mémoire projet : `~/.claude/projects/.../memory/project_pkp_non_pkp.md`
- Audit V3 : `docs/workplan/audits/2026-05-20-audit-integral-V3/03-accounting-audit.md` §F-S26-AC-08
- Code accounting actuel :
  - [supabase/migrations/20260517000010_refactor_create_sale_journal_entry.sql](../../supabase/migrations/20260517000010_refactor_create_sale_journal_entry.sql)
  - [supabase/migrations/20260517000011_create_purchase_journal_entry_trigger.sql](../../supabase/migrations/20260517000011_create_purchase_journal_entry_trigger.sql)
  - [supabase/migrations/20260517000012_create_calculate_vat_payable_rpc.sql](../../supabase/migrations/20260517000012_create_calculate_vat_payable_rpc.sql)
- Spec S26 : `docs/workplan/specs/2026-05-20-session-26-spec.md`
- Réglementation : Pasal 2 ayat (1) UU PPN — seuil PKP IDR 4.8 milliards CA annuel. PB1 : Perda Provinsi Bali sur taxes hôtellerie/restauration F&B.
