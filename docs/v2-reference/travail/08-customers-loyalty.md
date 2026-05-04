# Travail — Customers & Loyalty

> Last updated: 2026-05-03
> Référence : [`../04-modules/08-customers-loyalty.md`](../04-modules/08-customers-loyalty.md)
> Audits sources : `01-architecture-security-audit.md`, `03-code-quality-schema-audit.md`, `07-product-backlog-audit.md`

## Objectifs du module

1. **Loyalty engagement actif** : tier upgrades visibles (notification customer + cashier), expiration points motivante. Critère : 30 % de customers Bronze → Silver dans les 6 mois après lancement.
2. **B2B bridge avec retail** : un customer B2B peut aussi acheter en retail, son loyalty cumulant les deux. Critère : 1 record customer unifié.
3. **Data hygiène** : 0 doublon customer (téléphone normalisé, dedup actif). Critère : audit dedup retourne 0 high-confidence duplicates.
4. **Marketing basique** : birthday rewards, loyalty redemption visible, promotions ciblées. Critère : 10 % redemption rate sur birthday rewards.

---

## Tâches

### TASK-08-001 — Tier upgrade notifications [P2] [TODO]
**Contexte** : Tiers loyalty (Bronze/Silver/Gold/Platinum) existent (`CLAUDE.md` Business Rules). Quand un customer franchit un seuil, rien ne se passe visuellement → engagement raté. Inferred from code review + UX audit.
**Critère d'acceptation** :
- [ ] Trigger DB sur `loyalty_transactions` : si nouveau total points franchit un seuil tier → INSERT dans `tier_upgrades` (id, customer_id, old_tier, new_tier, occurred_at).
- [ ] À la prochaine transaction POS du customer, modal félicitations (« Welcome to Gold! ») avant checkout.
- [ ] Receipt mentionne le nouveau tier.
- [ ] Notification optionnelle (whatsapp ou email — voir TASK-08-006).
- [ ] Tests : customer 499pts → +50pts → modal Silver upgrade.
**Fichiers concernés** : nouvelle migration trigger + table `tier_upgrades`, `src/components/pos/modals/TierUpgradeModal.tsx` (à créer), `src/services/print/receiptFormatter.ts`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Trop intrusif. Settings « show tier upgrade modal » optionnel.

### TASK-08-002 — Points expiration policy [P2] [TODO]
**Contexte** : Pas de politique d'expiration points actuellement. Risque accumulation infinie + dette latente comptable (Store Credit Liability augmente sans limite). Inferred from accounting audit + product backlog.
**Critère d'acceptation** :
- [ ] Settings `loyalty.expiration_months` (default 12).
- [ ] Trigger ou cron : points non utilisés depuis N mois → `loyalty_transactions` type `expiration` (debit).
- [ ] Notification customer 30j avant expiration (whatsapp / email / SMS).
- [ ] Report : points expirés par mois.
- [ ] Tests : points créés Jan 2025 → expirent Jan 2026 si not used.
**Fichiers concernés** : nouvelle Edge Function `cron-expire-loyalty-points`, settings page `LoyaltySettingsPage.tsx`, `src/pages/reports/components/PointsExpirationTab.tsx` (optionnel).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Backlash customer si expirations rétroactives. Communiquer changement avant rollout.

### TASK-08-003 — B2B link with retail customer (unified profile) [P2] [TODO]
**Contexte** : Un customer B2B (restaurant qui achète gros) peut aussi venir acheter en retail. Actuellement, 2 records distincts → loyalty ne cumule pas. Inferred from product backlog + B2B module.
**Critère d'acceptation** :
- [ ] Schema : `customers.parent_customer_id` nullable self-FK pour lier B2B → retail (ou inversement).
- [ ] UI customer detail : bouton « Link to existing B2B/retail account ».
- [ ] Loyalty points cumulés sur le parent (ou un des deux selon choix UX).
- [ ] Reports : afficher cumul (retail + B2B).
- [ ] Migration de detection des doublons existants (par téléphone).
**Fichiers concernés** : nouvelle migration, `src/pages/customers/CustomerDetailPage.tsx`, `src/services/b2b/customerLinking.ts` (à créer).
**Dépend de** : `TASK-08-004` (dedup d'abord)
**Estimation** : `L`
**Risques** : Confusion UX si non clair quel record est « principal ». Documenter.

### TASK-08-004 — Customer merge / dedup [P2] [TODO]
**Contexte** : Pas de dedup actuellement. Téléphones non-normalisés peuvent créer doublons (ex : `+62812345`, `081 234 5`, `0812345`). Inferred from operational reality.
**Critère d'acceptation** :
- [ ] Migration : ajouter colonne `phone_normalized` (générée ou trigger) format E.164.
- [ ] Index unique partiel `(phone_normalized) WHERE phone_normalized IS NOT NULL` (warning si conflit, pas blocking).
- [ ] Page `/customers/duplicates` : liste paires high-confidence (même tel + nom similaire 80 %+).
- [ ] Action « Merge » : choisir master, transfère orders/loyalty/notes vers master, soft-delete autre.
- [ ] Audit log de chaque merge.
- [ ] Tests : merge customer A (10 orders) + B (5 orders) → master a 15 orders, B archived.
**Fichiers concernés** : nouvelle migration, `src/pages/customers/CustomerDuplicatesPage.tsx`, `src/services/customers/customerMerge.ts`.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Merge irréversible. Confirmation modale + audit log obligatoire. Soft-delete plutôt que hard.

### TASK-08-005 — Birthday rewards [P3] [TODO]
**Contexte** : Marketing basique : si customer a date de naissance enregistrée, lui offrir reward le jour J. Inferred from product backlog (customer segmentation/marketing missing).
**Critère d'acceptation** :
- [ ] Schema : `customers.birthday` (date, nullable, mois+jour suffisent).
- [ ] Cron Supabase : chaque jour, identifier customers dont c'est l'anniversaire.
- [ ] Auto-créer promotion code single-use 24h validity.
- [ ] Notification (whatsapp / email — TASK-08-006).
- [ ] Report : redemption rate birthday rewards.
- [ ] Tests : customer birthday today → promo code créé, valide 24h.
**Fichiers concernés** : nouvelle migration, Edge Function `cron-birthday-rewards`, `src/services/promotion/birthdayPromotion.ts` (à créer).
**Dépend de** : `TASK-08-006` (notifications nécessaires pour valeur)
**Estimation** : `M`
**Risques** : RGPD / data sensible (birthday = PII). Opt-in obligatoire.

### TASK-08-006 — Customer notifications pipeline (WhatsApp / SMS) [P2] [TODO]
**Contexte** : Indonésie = WhatsApp first. Pour B2B order ready, loyalty tier upgrade, birthday, payment reminder, on doit pouvoir notifier. Aucune intégration actuellement. Source : `docs/audit/07-product-backlog-audit.md§Strategic-9`.
**Critère d'acceptation** :
- [ ] Choix provider : WhatsApp Business API (Meta Cloud API) ou intermediary (Twilio, Wati, Fonnte).
- [ ] Schema : table `notification_templates` (key, channel, body_template, variables).
- [ ] Service `notificationService.send(customer_id, template_key, vars)`.
- [ ] Edge Function `notification-dispatcher` qui appelle l'API choisie.
- [ ] Settings : enable/disable channels, opt-in/opt-out customer.
- [ ] Audit log + status (sent/failed/delivered) sur table `notification_log`.
**Fichiers concernés** : nouvelle migration, nouveau Edge Function, `src/services/notifications/notificationService.ts`, settings page.
**Dépend de** : aucune
**Estimation** : `XL`
**Risques** : Provider externe = coût + KYC. Compliance opt-in (RGPD-like). Tester avec compte sandbox.

### TASK-08-007 — Loyalty redemption analytics [P3] [TODO]
**Contexte** : Pas de visibilité sur l'efficacité du programme loyalty. Combien de points créés vs redeemed ? Quel est le coût ? Inferred from reports module + accounting (Store Credit Liability).
**Critère d'acceptation** :
- [ ] Report dédié : KPIs (points issued, points redeemed, redemption rate, avg basket loyalty vs non-loyalty).
- [ ] Graphique trend mensuel.
- [ ] Tier distribution (% Bronze / Silver / Gold / Platinum).
- [ ] Top 10 redeemers.
- [ ] Export CSV/PDF.
- [ ] Permission `reports.financial` requise.
**Fichiers concernés** : `src/pages/reports/ReportsConfig.tsx`, `src/pages/reports/components/LoyaltyAnalyticsTab.tsx` (à créer), nouvelle vue ou RPC SQL.
**Dépend de** : `TASK-01-005` (granularité permissions)
**Estimation** : `M`
**Risques** : Aucun.

### TASK-08-008 — Migration phantom `customer_invoices` [P1] [TODO]
**Contexte** : 3 références à `customer_invoices` dans `services/b2b/creditService.ts` mais table absente. RPC `generate_next_customer_invoice_number` aussi phantom. B2B invoicing pourrait être broken. Source : `docs/audit/03-code-quality-schema-audit.md§A1` + `§A2`.
**Critère d'acceptation** :
- [ ] Décision : feature B2B invoicing utile (probablement OUI vu module B2B existant) ?
- [ ] Migration table `customer_invoices` (id, customer_id, invoice_number, issued_at, due_at, total, paid_at, status, pdf_url).
- [ ] Migration RPC `generate_next_customer_invoice_number()` avec sequence.
- [ ] RLS : authenticated read, permission `accounting.manage` write.
- [ ] Tests : créer invoice → numéro auto unique.
- [ ] `/db-schema-audit` ne flag plus.
**Fichiers concernés** : nouvelle migration, `src/services/b2b/creditService.ts`, hook `useCustomerInvoices.ts` à valider.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Si la feature n'est pas utilisée en production, la création est wasted work. Vérifier usage en runtime avant.

---

## Notes transverses

- **Loyalty rules** : 1pt / 1k IDR. Tiers Bronze 0%, Silver 500pts 5%, Gold 2000pts 8%, Platinum 5000pts 10% (cf. `CLAUDE.md` Business Rules).
- **Functions DB existantes** : `add_loyalty_points` / `redeem_loyalty_points` (cf. `CLAUDE.md`). Toujours passer par ces RPCs pour atomicité.
- **Customer pricing** : `retail` (standard), `wholesale`, `discount_percentage`, `custom` — la résolution finale via `get_customer_product_price()`.
- **PII** : nom, téléphone, birthday = PII. Toute nouvelle feature doit (a) opt-in customer, (b) audit log accès, (c) Sentry mask in replays (cf. `TASK-01-009`).
