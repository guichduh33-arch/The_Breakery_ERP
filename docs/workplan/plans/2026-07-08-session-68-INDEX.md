# Session 68 — INDEX : Facture PDF B2B (Vague 2, fiche 09 D2)

> **Date :** 2026-07-08 · **Branche :** `swarm/session-68` (base `072be6b1` = master post-#168 + spec/plan S68)
> **Spec :** [`docs/superpowers/specs/2026-07-08-b2b-invoice-pdf-design.md`](../../superpowers/specs/2026-07-08-b2b-invoice-pdf-design.md) · **Plan :** [`docs/superpowers/plans/2026-07-08-b2b-invoice-pdf.md`](../../superpowers/plans/2026-07-08-b2b-invoice-pdf.md)
> **Ferme :** module 09 B1.4 (« générer une facture officielle en PDF avec numérotation ») — un des 3 surclaims 🔴 de la fiche 09.

## Résumé livré

Le B2B a désormais une **facture PDF téléchargeable** portant un **numéro de série dédié annuel continu** `INV/YYYY/NNNNN`, attribué à la création de la commande. Depuis l'onglet **Invoices** du BO (`/b2b/payments`), un bouton **« Invoice PDF »** par ligne génère le document (en-tête entreprise, Bill To, lignes, statut de paiement) — **sans aucune ligne PB1/taxe** (B2B NON-PKP, `tax_amount=0`, décision propriétaire 2026-07-08).

## Décisions actées (propriétaire, 2026-07-08)
1. Numérotation : **série dédiée annuelle continue** `INV/YYYY/NNNNN` (pas de conformité fiscale lourde — NON-PKP).
2. Attribution **à la création** (bump `create_b2b_order_v3 → v4`) + backfill des commandes existantes.
3. **Aucune ligne PB1/taxe** sur la facture.
4. Mécanisme = **bump RPC v4** (pas de trigger).

## Migrations (`_129..134`)
- **`20260710000129`** — table `invoice_sequences (year PK, last_number)` + colonne `orders.invoice_number` (index unique partiel `WHERE NOT NULL`) + helper interne `_next_b2b_invoice_number_v1()` (SECURITY DEFINER, format unique `INV/YYYY/NNNNN`).
- **`20260710000130`** — **`create_b2b_order_v4`** (corps repris du LIVE v3, DEV-S57-02) : tirage du numéro APRÈS le credit-check (rollback = pas de trou), `invoice_number` dans `orders` + audit + les 2 envelopes (fraîche + replay). DROP v3, GRANT authenticated. **Money-path bump additif** — aucune autre logique modifiée.
- **`20260710000131`** — backfill idempotent (par année de `created_at`, ordre `(created_at, id)`, voided inclus par construction). **Dev = 0 commande B2B → no-op réel.**
- **`20260710000132`** — **`get_b2b_invoice_v1(uuid)`** lecture pure, gate `b2b.read`, STABLE. Renvoie `invoice/customer/lines/payment` ; `tax_amount` renvoyé tel quel (0) ; paiement dérivé de `view_b2b_invoices`.
- **`20260710000133`** — `view_b2b_invoices` + colonne `invoice_number` (en fin de SELECT, `CREATE OR REPLACE`).
- **`20260710000134`** — **[fix revue]** `REVOKE ALL invoice_sequences FROM authenticated` + `ENABLE ROW LEVEL SECURITY` (Critical #2 : le REVOKE de `_129` ne couvrait que PUBLIC/anon ; `authenticated` gardait GRANT ALL → écriture séquence via PostgREST possible).

Types regénérés (`create_b2b_order_v4`, `get_b2b_invoice_v1`, `invoice_sequences`, `invoice_number`) — **no-drift vérifié en closeout**.

## Edge Function
- **`generate-pdf` redéployée v4** (ACTIVE) : nouveau template `b2b_invoice` (`_shared/pdf-templates/b2b_invoice.ts`, permission `b2b.read`) + registry. Rendu miroir de `pb1.ts` (en-tête, Bill To company/NPWP/phone/email, lignes, totaux **sans ligne taxe**). Déploiement via subagent (contexte isolé, 26 fichiers).

## POS / BO
- **BO** : `useDownloadB2bInvoice` (get_b2b_invoice_v1 → generate-pdf `b2b_invoice` → `window.open`, sanitise le `/` du numéro pour `SAFE_FILENAME_REGEX`) ; `PdfTemplate` +`'b2b_invoice'` ; `useB2bInvoices` +`invoice_number` ; `B2bInvoicesTab` affiche le n° facture + bouton « Invoice PDF » par ligne ; `useCreateB2bOrder` repointé **v4** (+`invoice_number` au result).
- **POS** : inchangé (chantier BO-only).

## Tests
- **pgTAP `b2b_invoice.test.sql`** (nouvelle) : bloc 1 (helper+schéma) 6/6 · bloc 2 (v4 attribution+continuité) 6/6 · bloc 3 (backfill ordre+seeding) 4/4 · bloc 4 (get_b2b_invoice_v1 shape/tax0/format/lignes/P0003/P0002) 7/7 — **tous live**.
- **Ancres money-path re-vertes live** : `b2b_settlement` **14/14** (repointée v4, T10 credit-gate P0011) · `b2b_display_aware_stock` **3/3** (repointée v4) · `b2b_order_flag_aware_stock` A/B/C (repointée v4) · **`s44_money_gates` 12/12** (POS, non touché) · `b2b_foundation` + `record-b2b-payment.ts` repointées v4 (renames mécaniques).
- Smoke BO `b2b-invoices-tab` 20/20 (bouton + n° facture).
- Suite monorepo : typecheck OK · build + test — voir closeout.

## Revue DB consolidée (tâches 1-5)
2 Critical (corrigés) : **#1** ancres B2B appelaient encore `create_b2b_order_v3` (droppée) → repoint v4 dans 4 suites + re-vérif live ; **#2** `invoice_sequences` sans REVOKE `authenticated` → migration `_134`. Minors acceptés/dette (voir ci-dessous).

## Déviations
- **DEV-S68-01** — repoint `useCreateB2bOrder` → v4 **foldé dans le commit Task 5** (consommateur direct du DROP v3, pour garder la branche typecheck-verte à chaque commit) plutôt qu'en Task 7.
- **DEV-S68-02** — le test de backfill (bloc 3) sème des commandes `b2b_pending` et non `voided` (la CHECK `chk_orders_void_consistency` exige des métadonnées de void) ; le backfill inclut les voided **par construction** (WHERE sans filtre de statut).
- **DEV-S68-03** — Bill To utilise `phone`+`email` (colonnes `customers` réelles) ; **pas de colonne `address`** en base → omise proprement (spec mentionnait `address`).
- **DEV-S68-04** — déploiement de l'EF `generate-pdf` délégué à un subagent (contexte isolé) pour absorber les 26 fichiers sans polluer le contrôleur.
- **DEV-S68-05** — Task 6 (template) commitée avant le déploiement EF ; déploiement effectué en closeout (dépendance MCP contrôleur/subagent).

## Dettes (D-1..D-5)
- **D-1** — `B2bInvoicesTab` : `useDownloadB2bInvoice.isPending` est **partagé** (une instance de hook pour toutes les lignes) → cliquer « Invoice PDF » sur une ligne désactive les boutons PDF de **toutes** les lignes pendant le fetch. Code plan-mandaté (§4). Fix futur : pending par `orderId` (`Set`).
- **D-2** — `get_b2b_invoice_v1` : pour une commande `voided`, `amount_paid` retombe à 0 (via `view_b2b_invoices` qui exclut voided). Sans danger **aujourd'hui** car `cancel_b2b_order_v1` bloque l'annulation si une allocation existe (une commande voided n'a jamais eu de paiement alloué) — invariant croisé implicite à documenter si la garde d'annulation est un jour assouplie.
- **D-3** — les 3 nouvelles fonctions utilisent `REVOKE ALL ON FUNCTION` là où le bloc canonique récent utilise `REVOKE EXECUTE` (superset, fonctionnellement équivalent — cosmétique).
- **D-4** — le **rendu live du template `b2b_invoice` via l'EF n'a pas été invoqué end-to-end** (mint d'un PIN-JWT en test = lourd) : vérifié structurellement (miroir byte de `pb1.ts` + contrat de données `get_b2b_invoice_v1` validé). À exercer au premier usage réel (ou test e2e futur).
- **D-5** — le cas smoke (e) de `b2b-invoices-tab` n'impose pas `canRecord/canCancel=false` (sans impact fonctionnel).

## Money-path
`create_b2b_order` bumpée v3→v4 (additif : invoice_number seulement). `complete_order_with_payment_v17` / `pay_existing_order_v11` / `fire_counter_order_v4` **non modifiés**. Ancre `s44_money_gates` 12/12 re-verte en closeout.
