# Travail — Cash Register & Shift

> Last updated: 2026-05-03
> Référence : [docs/reference/04-modules/12-cash-register-shift.md](../04-modules/12-cash-register-shift.md)
> Sources d'audit : `docs/audit/00-executive-summary.md` (F3+F4 Z-Report ✅), `docs/audit/02-accounting-business-audit.md` (pas de JE auto à la close — pitfall), `docs/audit/05-uiux-design-audit.md` (touch targets), `docs/audit/08-operations-lan-audit.md` (multi-terminal)

## Objectifs du module

1. **Alerter en temps réel** sur les variances dépassant un seuil paramétrable (au lieu d'attendre la close).
2. **Z-Report PDF complet** signable manager (la base F3+F4 existe en console — manque PDF + workflow validation).
3. **Multi-cash-drawer** : un terminal peut piloter 2 tiroirs (caissier 1 + caissier 2) sans confusion.
4. **Mid-shift cash deposit/withdrawal** tracé (paying out 100k pour course, deposit du fond intermédiaire en safe).
5. **Shift handover UX** fluide : passer le poste à un collègue sans clôturer la session.
6. **Auto-close des sessions zombies** (>24h sans activité) pour éviter accumulation et faux positifs sur les rapports.

## Tâches

### TASK-12-001 — Variance threshold alert temps réel [P1] [TODO]
**Contexte** : Module ref pitfall — `close_shift` ne crée PAS de JE auto et la variance n'est connue qu'à la close. Si écart 100k IDR mid-shift (vol, oubli enregistrement), aucune alerte. Audit Mary recommande visibilité.
**Critère d'acceptation** :
- [ ] `pos_config.variance_alert_threshold` (default 50000 IDR) éditable.
- [ ] Hook `useShift` calcule `expected_cash` en temps réel (delta opening + Σ orders cash) ; déclenche toast warning si écart estimé > seuil (basé sur counts intermédiaires si saisis).
- [ ] Bouton "Cash count check" dans le toolbar POS : ouvre modal, caissier compte, comparaison expected vs actual ; persiste un `cash_check(session_id, count, variance, timestamp)`.
- [ ] Si variance > critical (>100k) → notification manager (in-app + Sentry breadcrumb).
**Fichiers concernés** : `src/hooks/useShift.ts`, `src/components/pos/shift/CashCheckModal.tsx` (nouveau), migration `cash_checks` table, `pos_config` JSON.
**Dépend de** : aucune
**Estimation** : M
**Risques** : tension si trop d'alertes — seuil doit être calibré.
**Notes** : pas de fix accounting requis (cash check ne génère pas de JE — info only).

### TASK-12-002 — Z-Report PDF complet signable [P1] [TODO]
**Contexte** : F3+F4 (CURRENT_STATE.md) ont livré la génération Z-Report en console. PDF imprimable signable manager n'existe PAS. Comptable demande archive papier.
**Critère d'acceptation** :
- [ ] Service `zReportPdfService.generate(session_id)` produit PDF (jsPDF) avec : entête (date, terminal, caissier), opening cash, transactions count + total par méthode, expected vs actual + variance, Top 10 produits, signature manager (zone vide).
- [ ] Bouton "Print Z-Report" dans `ShiftReconciliationModal` ; auto-print via print server si dispo (`printService.printReceipt` extended).
- [ ] PDF stocké Storage `z-reports/{date}/{session_number}.pdf` ; lien dans `pos_sessions.z_report_url` (nouvelle col).
- [ ] Manager peut "valider" le Z-Report (`pos_sessions.z_report_validated_by`, `z_report_validated_at`).
**Fichiers concernés** : `src/services/pos/zReportPdfService.ts` (nouveau, < 300 lignes), migration colonnes session, `ShiftReconciliationModal.tsx`.
**Dépend de** : aucune
**Estimation** : M
**Risques** : PDF lourd si beaucoup d'orders (>500) — pagination.
**Notes** : `shiftZReportExport.ts` existe déjà (710 lignes — flagged audit Amelia comme >300 lignes) → décomposer en passant.

### TASK-12-003 — Multi-cash-drawer support [P2] [TODO]
**Contexte** : Module ref permet déjà multi-caissier sur un terminal (chaque caissier ouvre sa propre session). Mais 1 terminal = 1 tiroir physique. Pour 2 tiroirs (rush midi), il faut conceptuellement séparer.
**Critère d'acceptation** :
- [ ] Table `cash_drawers(id, terminal_id, name, is_active)` ; un terminal peut avoir N drawers.
- [ ] `pos_sessions.drawer_id` FK obligatoire (backfill = 1er drawer du terminal).
- [ ] OpenShiftModal demande sélection drawer si > 1 actif.
- [ ] `expected_cash` agrège uniquement les orders payés sur ce drawer (orders.drawer_id à ajouter).
- [ ] Print server config par drawer (cf. `printer_configurations` table).
**Fichiers concernés** : migrations tables, `useShift.ts`, OpenShiftModal, settings page `/settings/cash-drawers`.
**Dépend de** : aucune
**Estimation** : L
**Risques** : besoin réel à valider — peut être P3 selon config The Breakery (1 terminal probablement = 1 tiroir).
**Notes** : si flag YAGNI, dégrader en P3.

### TASK-12-004 — Mid-shift cash in/out tracking (pay-outs / deposits) [P1] [TODO]
**Contexte** : Module ref pitfall : "sorties cash hors-ventes (paiement fournisseur en espèces) → module Expenses avec `payment_method='cash'`". Bon pour le JE, mais le caissier ne voit RIEN dans son shift → variance fantôme à la close.
**Critère d'acceptation** :
- [ ] Action POS "Cash payout" / "Cash deposit" dans le toolbar shift (permission `pos.cash_movement`).
- [ ] Modal saisie : montant, raison (Free text + select catégorie), reçu obligatoire si > 100k.
- [ ] Crée une ligne `cash_movements(session_id, type: payout|deposit, amount, reason, created_by, expense_id?)`.
- [ ] Si payout = paiement supplier → option "Link to expense" qui crée l'expense en parallèle (TASK-11-002).
- [ ] `expected_cash` calcul mis à jour : `opening + Σ cash sales - Σ payouts + Σ deposits`.
**Fichiers concernés** : migration `cash_movements`, `src/components/pos/shift/CashMovementModal.tsx`, `useShift.ts` recalc, audit log.
**Dépend de** : `TASK-12-001` (variance recalc).
**Estimation** : M
**Risques** : si pas tracé, variance fausse → adoption critique.
**Notes** : couvre aussi le cas "le boss prend 200k pour aller à la banque".

### TASK-12-005 — Shift handover (passer la main sans clôturer) [P2] [TODO]
**Contexte** : Pic 12h-14h : caissier A part en pause, caissier B prend la suite. Aujourd'hui : A close (variance bizarre car milieu de service) puis B open. Process lourd.
**Critère d'acceptation** :
- [ ] Action "Handover" dans toolbar : modal "Pass to caissier B" (selector user PIN-gated).
- [ ] Snapshot intermédiaire : `cash_check` (TASK-12-001) + signature des deux caissiers.
- [ ] La session reste `open` mais `assigned_user_id` change ; l'historique des assignments persisté dans `session_assignments`.
- [ ] Reports : transactions filtrées par `assigned_user_id` actif au moment de la transaction.
- [ ] À la close finale, le caissier qui ferme voit toute l'historique des handovers.
**Fichiers concernés** : migration `session_assignments`, `useShift.ts`, modal, reports update.
**Dépend de** : `TASK-12-001`, `TASK-12-004`.
**Estimation** : L
**Risques** : reporting plus complexe (qui a vendu quoi).
**Notes** : décharge psychologique du caissier A important (il "passe officiellement").

### TASK-12-006 — Auto-close des sessions zombies (>24h ouvertes) [P2] [TODO]
**Contexte** : Sessions ouvertes oubliées (caissier ferme l'app sans fermer le shift) polluent les listings et le `view_session_cash_balance`. Aujourd'hui : nettoyage manuel SQL.
**Critère d'acceptation** :
- [ ] Edge Function `auto-close-stale-shifts` (CRON daily 3am) cherche `pos_sessions WHERE status='open' AND opened_at < now()-interval '24h'`.
- [ ] Pour chaque, force `status='closed'`, `closed_by=system_user`, calcule expected_*, `actual_*=null`, `notes='Auto-closed (stale > 24h)'`.
- [ ] Notif manager le lendemain (in-app + email) listant les sessions auto-closed pour qu'il les revoit.
- [ ] Les orders rattachées restent valides (juste la session change de status).
**Fichiers concernés** : Edge Function, hook notif manager.
**Dépend de** : aucune
**Estimation** : S
**Risques** : faux positifs si une session vraiment longue (festival) — seuil configurable.
**Notes** : pattern reuse Edge Function CRON Supabase (cf. `recurring-expenses-generate` TASK-11-003).

### TASK-12-007 — JE automatique à la close (cash deposit en banque) [P2] [TODO]
**Contexte** : Module ref pitfall — `close_shift` ne crée PAS de JE. Le dépôt cash en banque doit être saisi manuellement dans `/accounting/journals`. Source d'oubli, divergence cash/banque.
**Critère d'acceptation** :
- [ ] Option dans CloseShiftModal : "Deposit cash to bank ?" (toggle + montant) : si activé, crée un JE automatique `Dr 1112 Bank / Cr 1110 Petty Cash` pour le montant déposé.
- [ ] Variance JE : si `cash_difference` ≠ 0, créer JE `Dr/Cr Loss/Gain on cash variance (5xxx/7xxx)` automatiquement.
- [ ] Wrapper engine `postShiftCloseJournalEntry(session_id)` côté `accountingEngine.ts`.
- [ ] Audit log + lien session ↔ JE dans UI.
**Fichiers concernés** : `src/components/pos/shift/CloseShiftModal.tsx`, `src/services/accounting/accountingEngine.ts`, mapping_keys `SHIFT_CASH_VARIANCE_LOSS` / `SHIFT_CASH_VARIANCE_GAIN`, migration seed mappings.
**Dépend de** : `TASK-10-004` (CHECK reference_type étendu — ajouter `shift_close`).
**Estimation** : M
**Risques** : manipuler les comptes bank/cash sans contrôle = risque erreur — option par défaut désactivée + permission `accounting.create`.
**Notes** : `TASK-10-001` doit être faite avant pour cohérence accounting globale.

## Vue transversale

### Dépendances inter-tâches

```
TASK-12-001 (variance alert temps réel)
    ↓ partage cash_check / cash_movements
TASK-12-004 (mid-shift in/out) → TASK-12-005 (handover)

TASK-12-002 (Z-Report PDF) ← indépendant
TASK-12-003 (multi-drawer) ← indépendant — peut être P3 selon besoin réel
TASK-12-006 (auto-close zombies) ← indépendant — quick win opérationnel
TASK-12-007 (JE auto close) → dépend TASK-10-001 + TASK-10-004
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Variance cash > 50k détectée < 1h | non (close-only) | 100% (TASK-12-001) |
| Sessions zombies > 24h | ~1-2/mois | 0 (TASK-12-006 auto) |
| Z-Report PDF signé manager | absent | obligatoire (TASK-12-002) |
| Cash deposits BDS tracés | manuel JE | auto JE (TASK-12-007) |

### Pitfalls connus

- `terminal_id_str` ≠ `terminal_id` (UUID FK) — confusion casse la recovery auto.
- Une session par caissier : reuse `get_user_open_shift` RPC pour silently recover.
- `expected_qris` / `expected_edc` séparés depuis migration `2026-04-30` — sessions antérieures ont l'ancien schéma : filtrer par `opened_at`.
- `close_shift` n'émet PAS de JE (cf. TASK-12-007 — fix prévu).
- Recovery agressive multi-tab → un terminal physique = un `terminal_id_str` unique.

### Risques transversaux

- **Adoption** : TASK-12-004 (cash in/out) inutile si caissiers ne le saisissent pas — formation + UI ergonomique.
- **Permissions** : TASK-12-005 (handover) demande `pos.cash_movement` + PIN — granularité RBAC à valider.
- **Migration data** : TASK-12-003 (multi-drawer) backfill `pos_sessions.drawer_id` via "1 terminal = 1 drawer default" pour ne pas casser les sessions historiques.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-12-001 | module 12 ref pitfall + 02-accounting | absence variance live |
| TASK-12-002 | CURRENT_STATE.md F3+F4 | partiellement livré (console only) |
| TASK-12-003 | besoin métier potentiel | YAGNI à valider |
| TASK-12-004 | module 12 ref pitfall | sorties cash hors-vente |
| TASK-12-005 | opérationnel rush midi | — |
| TASK-12-006 | nettoyage manuel SQL constaté | — |
| TASK-12-007 | 02-accounting-business-audit.md | JE manuel obligatoire actuellement |
