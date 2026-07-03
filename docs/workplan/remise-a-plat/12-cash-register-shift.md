# Module 12 — Caisse physique & shifts

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 12. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le cycle ouvrir → cash in/out → clôture aveugle → écart+JE → Z-report signé/annulé sous PIN est réel ; mais la doc surclame nettement le comptage : **pas de détail par coupure, pas de comptage en trois volets (espèces/mobile/carte), pas de PIN manager sur les gros écarts, pas d'alerte d'écart avant clôture**, et le suivi live ne montre ni panier moyen ni annulations.

## A. Ce qui fonctionne réellement (code vérifié)

- **Ouverture de session** : modal 2 étapes PIN → fond de caisse (montant unique + quick amounts + terminal LAN optionnel + notes) (`apps/pos/src/features/shift/OpenShiftModal.tsx:42-138`) ; insert direct `pos_sessions` gaté RLS par la permission `pos.session.open` (`apps/pos/src/features/shift/hooks/useShift.ts:34-49` ; policy `supabase/migrations/20260503000007_init_rls.sql:65-69`). Sans session : alerte `ShiftClosedState` + refus de vente client/serveur (cf. module 2). [UI câblée]
- **Cash in/out en cours de journée** : `CashInOutModal` (montant + motif ≥ 3 chars obligatoire) (`apps/pos/src/features/shift/components/CashInOutModal.tsx:31-55`) → `record_cash_movement_v2` (idempotent, gate `shift.cash_movement`, met à jour `cash_in_total`/`cash_out_total` → l'attendu s'ajuste) (`supabase/migrations/20260603000016:87-125`). Le RPC sait émettre une JE pour `apport_owner`/`bank_transfer` (`_016:127-165`) **mais la modal POS n'expose pas le `reason_code`** (le hook le supporte : `useCashMovement.ts:20,51`) → aucune JE émise depuis l'UI. [UI câblée, JE non exposée]
- **Clôture** : **comptage à l'aveugle** (l'attendu et l'écart sont masqués jusqu'à confirmation du comptage — anti-« comptage ajusté ») (`apps/pos/src/features/shift/components/CloseShiftModal.tsx:5-10,44,108-148`) ; seuils d'écart configurables `business_config.shift_variance_threshold_abs/pct` (défauts 50 000 IDR / 0,5 % — `useShiftCloseSummary.ts:16-17,52-62`, seed `20260517000136`) ; badge coloré + **note obligatoire au-delà du seuil** (UI seulement) (`CloseShiftModal.tsx:53-54,169-173`). [UI câblée]
- **`close_shift_v2`** (`supabase/migrations/20260606000015`) : gate `shift.close`, `FOR UPDATE`, expected = opening + cash_sales + in − out (`:89`), **JE d'écart automatique** (over → CR 4910 / short → DR 5910, idempotente par session) (`:107-145`), replay idempotent sur session déjà fermée (`:71-78`), snapshot Z + insert `z_reports` draft + audit (`:165-180`). [RPC]
- **Z-report** : snapshot figé par `_build_zreport_snapshot` — **ventilation par moyen de paiement**, ventes brutes, refunds, voids, dépenses cash, top produits (`supabase/migrations/20260606000014:35-60`) ; PDF généré par l'EF `generate-zreport-pdf` (upload `zreports/<yyyy>/<mm>/…`, replay idempotent, chaîné non-bloquant à la clôture — `useCloseShift.ts:55-67` ; `supabase/functions/generate-zreport-pdf/index.ts:4-5,136-137`) ; **signature depuis le BO** via `sign_zreport_v2` avec PIN validé serveur (`apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts:27-29`, migration `20260621000015`) ; **annulation sous PIN** via `void_zreport_v2` (`useVoidZReport.ts:29`, migration `20260710000062`, `_verify_pin_with_lockout`). Page BO `cash-register/zreports` gatée `zreports.read` (`apps/backoffice/src/routes/index.tsx:452-456`). [UI câblée]
- **Multi-caissiers par terminal** : une session par utilisateur (`useCurrentShift` filtre `opened_by`, `useShift.ts:16-21`) ; `LiveSessionsModal` liste toutes les sessions ouvertes (caissier, ouverture, nb transactions, net cash in/out, refresh 30 s) (`apps/pos/src/features/shift/LiveSessionsModal.tsx`, `useLiveSessions.ts:40-61`). [UI câblée]
- **Suivi pendant le service** : bandeau KPI de l'historique — Total / Cash / Card / Other + nombre de transactions (`apps/pos/src/features/order-history/components/OrderHistoryStats.tsx:25-36`). [UI câblée]

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Ouvrir sa session avec comptage du fond (détail **par coupure** possible).
- B1.2 Suivre en direct pendant le service son chiffre, son **panier moyen**, ses **annulations**.
- B1.3 Cash in/out avec motif tracé ; l'attendu s'ajuste automatiquement ; **alerte si un écart anormal se dessine avant la clôture**.
- B1.4 Le soir : comptage en **trois volets (espèces / mobile / carte)**, écart calculé et coloré, raison obligatoire au-delà du seuil, **validation manager par PIN pour les gros écarts**.
- B1.5 Rapport Z archivé en PDF **pendant dix ans**, signé depuis le bureau ; annulation protégée par PIN manager.
- B1.6 L'écart génère automatiquement l'écriture comptable de perte ou de gain.
- (Scénario) Plusieurs caissiers se relaient sur le même terminal, chacun sa session ; le gérant repère un **manque récurrent par caissier** dans l'historique.

### B2. Annoncé « À venir »
- B2.1 Passage de relais sans clôturer.
- B2.2 Fermeture automatique des sessions oubliées.
- B2.3 Double signature caissier + manager pour les écarts importants.
- B2.4 Dépôt bancaire intégré (bordereau photographié, tiroir → coffre → banque).
- B2.5 Comptage par coupure obligatoire en option.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Ouverture avec comptage du fond, détail par coupure possible | Montant unique + quick amounts (`OpenShiftModal.tsx:222-267`) — **aucune saisie par coupure** nulle part (ni open ni close) ; incohérent aussi avec B2.5 qui promet la coupure « en option » à venir | 🟠 PARTIEL (le « par coupure » surclame) |
| B1.2 | Live : chiffre, panier moyen, annulations | Chiffre par méthode + nb transactions via `OrderHistoryStats` ; `LiveSessionsModal` = nb commandes + net cash mvts ; **ni panier moyen ni compteur d'annulations** | 🟠 PARTIEL |
| B1.3 | Cash in/out motif tracé, attendu ajusté, **alerte d'écart anticipée** | Motif obligatoire + attendu ajusté ✅ (`record_cash_movement_v2`) ; `VarianceWarningBadge` n'est monté **que** dans `CloseShiftModal` (étape review) — aucune alerte pré-clôture (grep : 2 seuls call-sites) | 🟠 PARTIEL (l'alerte anticipée n'existe pas) |
| B1.4 | Comptage 3 volets, écart coloré, raison > seuil, **PIN manager gros écarts** | Comptage **espèces uniquement** (`close_shift_v2(p_counted_cash)`) — les totaux mobile/carte sont calculés dans le snapshot Z mais jamais comptés/rapprochés ; écart coloré ✅ ; note > seuil ✅ (client-side only) ; **aucun PIN à la clôture** (ni arg RPC ni step UI) | 🔴 MANQUANT (2 sous-claims sur 4) |
| B1.5 | Z PDF archivé 10 ans, signé du BO, annulation PIN | PDF uploadé dans le bucket `zreports` (rien ne le supprime, mais **aucune politique de rétention/immutabilité 10 ans** — bucket ni WORM ni versionné) ; signature `sign_zreport_v2` PIN ✅ ; annulation `void_zreport_v2` PIN ✅ | 🟠 PARTIEL (le « dix ans » est une intention, pas un mécanisme) |
| B1.6 | JE d'écart automatique | `close_shift_v2:107-145` — over/short vers 4910/5910, idempotente | ✅ CONFORME |
| Scénario | Multi-caissiers même terminal ; manque récurrent par caissier repérable | Sessions par utilisateur + LiveSessions ✅ ; côté BO seule la **liste des Z-reports** existe (`ZReportsListPage`) — **aucun rapport « tendance des écarts par caissier »** | 🟠 PARTIEL |

**Bonus code (le code fait plus que la doc) :**
- 🔵 **Comptage à l'aveugle** à la clôture (l'attendu est masqué pendant la saisie — anti-fraude plus fort que ce que la doc décrit) (`CloseShiftModal.tsx:5-10`).
- 🔵 Seuils d'écart **configurables** dans `business_config` (abs + %), pas codés en dur.
- 🔵 JE automatique sur cash in/out `apport_owner`/`bank_transfer` côté RPC (DR/CR 1110↔3100/1112) — capacité présente, non exposée dans l'UI POS.
- 🔵 Replay idempotent de la clôture et de la génération PDF ; audit_logs sur close + draft Z.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Exposer le `reason_code` dans `CashInOutModal`** (select apport propriétaire / transfert banque / rotation / divers) — le RPC et le hook le supportent déjà (`useCashMovement.ts:51`) ; sans quoi les mouvements de caisse ne génèrent jamais leur JE. Done : un apport owner produit sa JE 1110/3100.
2. **Alerte d'écart anticipée (B1.3)** : monter `VarianceWarningBadge`/un indicateur « attendu vs théorique » dans le drawer shift (les données `useShiftCloseSummary` existent) — attention à ne pas casser le blind count : n'afficher qu'un signal, pas le montant attendu.
3. **Panier moyen + annulations dans `OrderHistoryStats`** : total/count existent déjà ; ajouter avg = total/count et un compteur voids de la session. Done : B1.2 conforme.
4. **Note d'écart > seuil enforced serveur** : ajouter le check dans `close_shift_v2` (aujourd'hui UI-only, contournable par appel RPC direct).

### D2. Chantiers moyens (1 session, plan requis)
1. **PIN manager pour gros écarts à la clôture (B1.4)** : bump `close_shift_v3` avec `p_manager_pin` requis quand |variance| > seuil (pattern `_verify_pin_with_lockout` de `void_zreport_v2`) + step PIN dans `CloseShiftModal` ; DROP v2 même migration ; pgTAP.
2. **Comptage en 3 volets (B1.4)** : étendre la clôture à `p_counted_qris`/`p_counted_card` (ou jsonb par méthode), variance par volet dans le snapshot Z et la JE (compte par méthode) ; UI 3 onglets. Plan requis (touche close_shift, Z-snapshot, PDF, BO).
3. **Comptage par coupure (B1.1/B2.5)** : grille de coupures IDR à l'open et au close, total auto, stockage jsonb `denominations` sur `pos_sessions` — optionnel via `business_config`.
4. **Rapport « écarts par caissier » côté BO** : RPC d'agrégation `variance_total` par `closed_by`/jour de semaine + page Reports (répond au scénario « manque récurrent le mardi »).

### D3. Chantiers lourds (spec dédiée avant code)
1. **Passage de relais sans clôture (B2.1) + fermeture auto des sessions oubliées (B2.2)** : machine à états de session (handover count intermédiaire, propriété du tiroir), cron de fermeture — spec dédiée (impacte gate de vente, Z-report, JE).
2. **Dépôt bancaire intégré (B2.4)** : bordereau + photo + chaîne tiroir→coffre→banque — s'appuie sur `record_cash_movement_v2 bank_transfer` (JE déjà là) + storage ; spec courte mais cross-modules (dépenses/compta).
3. **Rétention légale 10 ans des Z (B1.5)** : bucket dédié à politique d'immutabilité (pas de delete), inventaire annuel, éventuellement horodatage/signature du PDF — à specifier avec la contrainte légale indonésienne.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B1.1 : retirer « (détail par coupure possible) » — contradictoire avec B2.5 et absent du code.
2. B1.4 : reformuler en « comptage des espèces (les totaux carte/mobile sont rapportés automatiquement dans le Z) » et retirer « validation manager par PIN » tant que D2.1 n'est pas livré.
3. B1.3 : retirer « une alerte prévient… avant même la clôture » (ou livrer D1.2 d'abord).
4. B1.5 : **ne pas adoucir le « dix ans »** — c'est l'obligation légale indonésienne de conservation des documents comptables, pas une intention. Écrire : « archivé en PDF ; le mécanisme d'immutabilité garantissant les 10 ans légaux reste à outiller (cf. D3.3) » et garder D3.3 comme chantier.
5. Ajouter le **comptage à l'aveugle** dans la description — c'est un vrai point fort anti-fraude non documenté.

## E. Dépendances croisées
- **Modules 2/3 (Panier/Paiements)** : le gate de vente et l'attendu de caisse dépendent de ce module ; le 3-volets (D2.2) dépend de la ventilation `order_payments` par méthode.
- **Module 10 (Comptabilité)** : JE d'écart (4910/5910), JE cash movements (1110/3100/1112), mapping par méthode si 3 volets ; `check_fiscal_period_open` fail-closed (S54) est déjà dans le chemin de clôture.
- **Module 11 (Dépenses)** : depuis `20260706000019`, une dépense cash **n'impacte plus le tiroir** — le trigger `sync_cash_expense` est droppé et `EXPENSE_CASH_OUT` est remappé sur 1111 Petty Cash (cf. fiche 11 C-B1.6). Si le lien tiroir↔dépenses doit revivre, c'est une décision produit à trancher ici (le D2 de la fiche 11 renvoie à ce module).
- **Module 14 (Rapports)** : D2.4 (tendance écarts par caissier) vit côté BO Reports.
- **Module 21 (Réseau local)** : sélection du terminal à l'ouverture (`useLanDevices`).
