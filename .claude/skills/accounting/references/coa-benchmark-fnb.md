# Benchmark COA — boulangerie-café (F&B) de même taille

Référence pour la mission « concevoir / faire évoluer le plan comptable ». Cadre : PME
F&B indonésienne (SAK EMKM / SAK EP comme boussole de présentation), une entité, un
site, POS + B2B + production interne. Ce fichier donne le **plan cible représentatif**
et la **méthode d'écart** — il ne décide rien : chaque écart devient une proposition à
Mamat.

## Méthode d'écart (à dérouler à chaque audit COA)

1. Lire le COA live (`SELECT … FROM accounts ORDER BY code`) — jamais depuis un extrait.
2. Pour chaque bloc du benchmark ci-dessous, classer :
   - **(a) Manque réel** — le flux existe dans le métier mais aucun compte ne le porte →
     proposition de création (code, classe, `is_postable`, `cash_flow_section`
     explicite, mapping + émetteur identifié).
   - **(b) Choix assumé** — le projet a décidé de ne pas porter ce flux (ex. 1151
     désactivé NON-PKP, pas de JE sur transferts internes, ADR-014). On ne touche pas.
   - **(c) Doublon / résidu** — compte à zéro mouvement sans mapping ni rôle → candidat
     à la désactivation via `update_account_active` (jamais de DROP si lignes
     historiques).
3. Un compte proposé sans **émetteur automatique identifié** (trigger ou RPC qui le
   mouvementera) est refusé d'office : il deviendrait un doublon dormant de plus.
4. Livrer la proposition en conversation : tableau code / nom / classe / section cash
   flow / mapping / émetteur / justification benchmark.

## Plan cible — blocs et correspondance live (relevé 2026-08-17)

### 1xxx Actifs

| Bloc benchmark | Comptes types | État live 2026-08-17 |
|---|---|---|
| Trésorerie | caisse, petite caisse, fonds de change, banques, clearings QRIS/carte, cash in transit | ✅ complet : 1110–1117 |
| Créances | AR clients, AR B2B, provision créances douteuses | ✅ 1131/1132 ; ❌ pas de provision (allowance) — acceptable en SAK EMKM (write-off direct via 6520), à revoir si l'encours B2B grossit |
| Stocks | matières premières, semi-finis, produits finis, marchandises | ✅ 1141–1143 (pas de compte semi-finis distinct — foldé, choix assumé) |
| Charges constatées d'avance | loyer payé d'avance, assurances | ❌ **absent** — le loyer annuel payé en une fois s'impute en charge au décaissement. Manque (a) si des paiements d'avance significatifs existent |
| Prêt actionnaire | piutang pemegang saham | ❌ absent — voir « Prêt actionnaire soldé en dividende » ci-dessous |
| **Immobilisations** | four, laminoir, vitrines, mobilier, agencements, matériel IT + **amortissements cumulés** (15xx) | ❌ **absent en totalité** — aucun compte de classe 1 non-courant. Tout équipement acheté part en charge. Écart n°1 vs une entreprise de même taille : fausse le bilan, concentre la charge l'année d'achat et prive du levier fiscal de l'amortissement étalé. **Bloc proposé détaillé ci-dessous** |

### 2xxx Passifs

| Bloc | Comptes types | État live |
|---|---|---|
| Dettes fournisseurs | AP | ✅ 2141 |
| Dettes fiscales | PB1/PBJT payable, **PPh payable (21 salariés / final UMKM)** | ✅ 2110 ; ❌ pas de compte PPh — manque (a) dès qu'il y a des salariés déclarés ou un PPh final mensuel à provisionner |
| Dettes sociales & salariales | salaires à payer, BPJS Kesehatan/Ketenagakerjaan à reverser | ❌ absent — la paie semble passer en charge au décaissement. Manque (a) si la paie est mensualisée avec décalage |
| Dettes clients | loyalty liability, store credit | ✅ 2210/2220 — au-dessus du standard (beaucoup de PME ne les comptabilisent pas) |
| Résidus | 2142 VAT Output (PKP), 2143 PB1 doublon | (c) doublons dormants — zéro mouvement, aucun mapping ; candidats désactivation |

### 3xxx Capitaux propres

**Forme juridique confirmée par Mamat le 2026-08-17 : PT.** Le bloc actuel (3100 Owner
Capital, 3110 Owner's Drawing, 3200 Retained Earnings, 3300 agrégat) est un bloc
d'entreprise individuelle — écarts (a) à proposer :
- 3100 → refléter le **capital social (Modal Saham)** au montant de l'acte ; apports
  ultérieurs hors capital → compte d'apport distinct, pas de mélange.
- **3110 Owner's Drawing n'est pas un concept PT** : les prélèvements de l'owner
  passent par 1135 Shareholder Loan (soldé en dividende, voir ci-dessous) ou par un
  salaire de gérant. À terme : 3110 désactivé via `update_account_active` — après
  bascule des flux, jamais avant.
- Réserve légale (UU PT 40/2007) : sous-compte de 32xx si les distributions deviennent
  régulières.

### 4xxx Produits

✅ 4100 POS, 4131 B2B, 4900 remises (contra), 4910 variance gain, 4920 breakage,
4510 ajustements stock. ❌ 4111 « POS Revenue » et 4190 « Sales Discount (Promo) » :
doublons dormants (c) — aucun mapping, zéro ligne au 2026-08-17.
Raffinement possible (pas un manque) : ventiler 4100 par canal (dine-in / take-away /
delivery) — à ne proposer que si un besoin de pilotage le justifie, la ventilation par
produit existe déjà via les rapports.

### 5xxx COGS / 6xxx Opex

✅ 5110 COGS production, 5210 waste, 6111–6117, 6190, 6510, 6520.
⚠️ 5910 Cash Variance Loss : code classe 5, `account_class=6` — renommage 6910 différé,
ne pas « corriger » sans décision.
❌ Absents vs benchmark : 6120 Depreciation (lié aux immobilisations), 6118 BPJS/charges
sociales employeur si salariés déclarés. Les autres opex passent par les catégories de
dépenses (`EXPENSE_DEFAULT` → 6190) — vérifier périodiquement que 6190 ne devient pas
un fourre-tout (> ~20 % des opex = les catégories manquent de granularité).

## Bloc immobilisations proposé — équipement + amortissement (standards indonésiens)

Proposition à valider par Mamat avant toute migration ; aucun compte ne se crée sans
son émetteur (voir invariants).

### Comptes

| Code | Nom | Classe | postable | cash_flow_section | Contenu |
|---|---|---|---|---|---|
| 1500 | Fixed Assets (groupe) | 1 | non | investing | regroupement |
| 1510 | Equipment - Production (Peralatan Produksi) | 1 | oui | investing | fours, pétrins, laminoirs, froid pro |
| 1520 | Furniture & Fixtures | 1 | oui | investing | mobilier salle, vitrines |
| 1530 | Leasehold Improvements | 1 | oui | investing | agencements du local loué |
| 1540 | IT & POS Equipment | 1 | oui | investing | terminaux, imprimantes, tablettes |
| 1590 | Accumulated Depreciation (contra-actif) | 1 | oui | investing | crédité par la dotation |
| 6120 | Depreciation Expense | 6 | oui | operating | dotation mensuelle |

### Barème fiscal indonésien (UU PPh art. 11, groupes d'actifs PMK 72/2023 — relevé début 2026, à re-vérifier)

| Groupe fiscal | Durée | Linéaire | Dégressif | Exemples Breakery |
|---|---|---|---|---|
| Kelompok 1 | 4 ans | 25 % | 50 % | IT/POS (1540), petit équipement, mobilier léger |
| Kelompok 2 | 8 ans | 12,5 % | 25 % | fours, pétrins, laminoirs, froid professionnel, mobilier métal |
| Bâtiment permanent | 20 ans | 5 % | — | seulement si local détenu ; agencements locatifs (1530) : SAK sur durée du bail, fiscal selon nature |

### Règles de fonctionnement proposées

- **Une seule méthode : linéaire, commercial aligné sur fiscal** (SAK EMKM l'admet) —
  pas d'écart comptable/fiscal à suivre, taille d'entreprise oblige. Prorata au **mois
  de mise en service**.
- Seuil de capitalisation à fixer par Mamat (usuel : ~2–5 M IDR ; en dessous → charge
  directe 6114/6116).
- **Registre des actifs** obligatoire : date de mise en service, coût TTC (PPN foldée,
  NON-PKP — la PPN entre dans la base amortissable), groupe fiscal, durée, valeur nette.
- Dotation : JE mensuelle DR 6120 / CR 1590. Émetteur automatique à créer (table
  registre + RPC de dotation périodique) = **chantier à part entière, probablement un
  ADR** ; en attendant, JE manuelle mensuelle documentée — c'est l'exception manuelle
  légitime au sens du skill.
- Cession/mise au rebut : sortir coût ET amortissements cumulés, écart en
  4510/6510 (plus/moins-value) — jamais de solde orphelin en 1590.
- En régime PPh final UMKM, l'amortissement n'a **aucun effet fiscal** (impôt sur CA) —
  l'intérêt fiscal du bloc ne joue qu'en régime réel ; l'intérêt bilanciel joue toujours.

## Prêt actionnaire soldé en dividende (fin d'exercice)

Mécanisme demandé : l'owner prélève en cours d'année via un compte de prêt, soldé au
31/12 par une distribution de dividendes. Ce montage n'existe qu'en PT — **forme
confirmée par Mamat le 2026-08-17 : The Breakery est une PT**, le montage est donc
applicable et remplace l'usage du drawing 3110. Fiscalité et garde-fous détaillés dans
`fiscal-optimization-nonpkp.md` (levier n°5).

### Comptes proposés

| Code | Nom | Classe | postable | cash_flow_section | Rôle |
|---|---|---|---|---|---|
| 1135 | Shareholder Loan (Piutang Pemegang Saham) | 1 | oui | financing | prélèvements de l'année (DR à chaque sortie de cash) |
| 2150 | Dividend Payable (Utang Dividen) | 2 | oui | financing | déclaré au RUPS, apuré par compensation |
| 2115 | PPh Payable - Dividend (final 10 %) | 2 | oui | operating | retenue à la source à reverser |

### Cycle annuel

1. En cours d'année, prélèvement : DR 1135 / CR 1110-1112 (sort en financing au cash
   flow — pas en charge, pas déductible).
2. Clôture : RUPS déclare le dividende (uniquement si 3200 Retained Earnings positif,
   réserve légale UU PT 40/2007 respectée) : DR 3200 / CR 2150 pour le brut.
3. Compensation : DR 2150 / CR 1135 (solde le prêt) ; retenue : DR 2150 / CR 2115 pour
   le PPh final — le brut déclaré doit donc couvrir prêt + retenue, sauf exonération
   (réinvestissement, voir levier n°5).
4. **1135 doit revenir à zéro chaque exercice.** Un prêt qui roule d'année en année est
   requalifiable en dividende déguisé (avec pénalités) — c'est le garde-fou n°1.

Ces écritures sont des événements de gouvernance annuels : `create_manual_je`
(PIN-gaté) est le véhicule légitime, pas un émetteur automatique.

## Invariants de codification (à respecter dans toute proposition)

- Plages : 11xx courant / 15xx immobilisations (à créer) / 21xx fiscal / 214x
  fournisseurs / 215x dividendes (à créer) / 22xx dettes clients / 31xx capital /
  4xxx produits / 5xxx COGS / 6xxx opex. `113x` = créances (1135 prêt actionnaire
  inclus), `114x` = stocks — jamais l'inverse.
- `cash_flow_section` **explicite** : trésorerie → `none`, immobilisations → `investing`,
  equity → `financing`, reste → `operating`. Le DEFAULT `operating` silencieux est le
  piège n°1.
- Comptes de regroupement → `is_postable=false`.
- Un compte = un usage émetteur. Un compte « au cas où » est refusé.
