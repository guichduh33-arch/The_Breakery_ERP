# Optimisation fiscale légale — cadre NON-PKP / PBJT (Lombok, NTB)

Référence pour la mission « optimisation fiscale ». Objectif : limiter la charge d'impôt
**sans modifier la valeur de l'entreprise ni sortir de la légalité**. Le cadre
juridictionnel est gravé par l'ADR-005 (irrévocable) : NON-PKP, PBJT municipale 10 %
collectée pour le Bapenda.

> ⚠️ **Les textes cités sont des relevés datés (état du droit connu début 2026), pas des
> invariants.** Taux, seuils et fenêtres d'éligibilité changent par décret : toute
> proposition chiffrée se re-vérifie avec un conseil fiscal local AVANT décision. Le
> skill chiffre et compare ; **Mamat + conseil fiscal décident**.

## Les trois impôts en jeu — et ce qui s'optimise vraiment

| Impôt | Nature | Optimisable ? |
|---|---|---|
| **PBJT 10 %** (« PB1 ») | Taxe locale sur les ventes F&B, collectée auprès du client, reversée au Bapenda | **Non.** Pass-through : ce n'est pas une charge de l'entreprise. La seule « optimisation » est la conformité : base juste (`_pb1_split`, dédup void/refund), reversement à l'heure, zéro pénalité/majoration |
| **PPN 11 %** (fournisseurs PKP) | Payée sur les achats, **non-récupérable** en NON-PKP, foldée dans le coût | **À la marge.** À prix égal, un fournisseur non-PKP évite 11 % de coût foldé. Critère de sourcing, pas de montage — la qualité prime |
| **PPh** (impôt sur le revenu/bénéfice) | Selon régime : final UMKM sur le CA, ou régime réel sur le bénéfice | **Oui — c'est ici que vivent tous les leviers légaux** |

## Levier n°1 — capture exhaustive des charges légitimes

En régime réel, chaque charge légitime non enregistrée = du bénéfice imposable fictif.
Le module expenses + les JE automatiques sont l'outil d'optimisation principal :

- Toute dépense réelle passe par le workflow expenses (justificatif, approbation,
  catégorie correcte) — jamais de dépense « en cash non saisie ».
- Les charges portées par les automatisations (COGS production, waste, écarts d'opname,
  bad debt B2B, variance de caisse) sont déjà déductibles ET documentées : ne jamais les
  neutraliser « pour faire joli », elles réduisent l'assiette en toute légalité.
- Salaire du personnel : déductible s'il est déclaré (et déclenche PPh 21/BPJS — le
  net des deux se chiffre, il reste généralement favorable et sécurise le contrôle).
- Test périodique : `6190 Other Operating Expense` > ~20 % des opex = des catégories
  manquent, et des déductions se perdent en lisibilité de contrôle.

## Levier n°2 — immobiliser et amortir (dépend du chantier COA 15xx)

Tant que le COA n'a pas de comptes d'immobilisations (écart n°1 du benchmark), tout
équipement part en charge l'année d'achat : déduction concentrée, bilan sous-évalué.
Immobiliser + amortir lisse la déduction, colle au réel économique et **ne modifie pas
la valeur de l'entreprise — il la révèle**. Le système complet (comptes 15xx/6120,
barème UU PPh art. 11 : Kelompok 1 = 4 ans 25 % linéaire, Kelompok 2 = 8 ans 12,5 %,
bâtiment permanent 20 ans 5 % ; groupes d'actifs PMK 72/2023) est spécifié dans
`coa-benchmark-fnb.md`. Points fiscaux clés : linéaire commercial = fiscal (zéro écart
à suivre), prorata au mois de mise en service, la PPN fournisseur foldée (NON-PKP)
**entre dans la base amortissable**. En régime UMKM final (impôt sur CA),
l'amortissement n'a aucun effet fiscal : ce levier ne compte qu'en régime réel —
l'inclure dans le comparatif de régimes.

## Levier n°3 — choix du régime PPh (décision Mamat + conseil, jamais le skill)

Relevé début 2026, à re-vérifier :

- **PPh final UMKM ~0,5 % du chiffre d'affaires mensuel** (lignée PP 23/2018 → PP
  55/2022) : éligible sous ~4,8 Mds IDR de CA annuel, pour une durée limitée selon la
  forme juridique (personne physique ~7 ans, CV/firma ~4 ans, PT ~3 ans). Simple, mais
  aveugle aux charges : on paie même en perte.
- **Exonération personne physique** : part de CA annuel ≤ ~500 M IDR non imposée au
  final UMKM (UU HPP 7/2021) — vérifier l'applicabilité à la forme juridique réelle.
- **Régime réel** : comptabilité complète (ce que le module fournit), impôt sur le
  bénéfice net ; pour une PT, facilité art. 31E (réduction sur la tranche de bénéfice
  correspondant à un CA ≤ 4,8 Mds) — à re-chiffrer sur les taux en vigueur.
- **Méthode du comparatif** : sortir du module `get_profit_loss` sur 12 mois glissants →
  calculer (CA × taux final) vs (bénéfice réel × barème applicable) → présenter les deux
  colonnes avec sensibilité (marge nette au-dessus/au-dessous du point d'équivalence
  ≈ taux final ÷ taux sur bénéfice). Le module donne l'avantage décisif : un P&L fiable
  rend le régime réel praticable, ce qui n'est pas vrai des concurrents sans compta.

## Levier n°4 — timing et forme, dans les limites

- Fin d'exercice : avancer des charges certaines (maintenance due, achats de
  consommables réellement nécessaires) / différer une reconnaissance de produit
  **uniquement si le fait générateur le permet** — jamais d'anti-datage, la date de JE
  suit le fait générateur, le fiscal guard l'impose déjà.
- Rémunération de l'owner : en entreprise individuelle/CV le « drawing » (3110) n'est
  pas déductible ; en PT un salaire de gérant l'est (mais PPh 21). Le bon montage dépend
  du régime — à chiffrer dans le comparatif, pas à trancher seul.
- Store credit / loyalty : la reconnaissance du produit au breakage (4920) et de la
  charge à l'octroi (6117) est déjà correcte — ne pas « optimiser » ces flux, ils sont
  le modèle.

## Levier n°5 — prêt actionnaire soldé en dividende en fin d'exercice (PT uniquement)

Mécanisme : l'owner prélève en cours d'année via `1135 Shareholder Loan` (jamais en
charge), et le RUPS de clôture déclare un dividende qui solde le prêt par compensation.
Comptes et cycle d'écritures : `coa-benchmark-fnb.md`.

**Pourquoi c'est un levier** : le dividende versé à une personne physique résidente
supporte un **PPh final de 10 %** (relevé début 2026) — voire **0 % s'il est réinvesti
en Indonésie ≥ 3 ans** dans les formes prévues (UU HPP art. 4(3)f jo. PMK 18/2021,
obligation de reporting du réinvestissement à la DJP). À comparer au salaire de gérant :
déductible pour la PT mais PPh 21 progressif chez le bénéficiaire — l'arbitrage
salaire/dividende se chiffre au barème en vigueur, il ne se devine pas.

**Conditions strictes — hors d'elles, le montage est une ligne rouge :**
- **Forme PT obligatoire — confirmée par Mamat le 2026-08-17 : The Breakery est une
  PT.** Le levier est donc applicable. Conséquence : `3110 Owner's Drawing` n'est pas
  un concept PT — les prélèvements de l'owner passent par 1135 (prêt) ou par un salaire
  de gérant, jamais par un drawing ; voir l'écart equity dans `coa-benchmark-fnb.md`.
- **Dividende licite** : Retained Earnings 3200 positif après la dotation à la réserve
  légale (UU PT 40/2007), décision RUPS documentée, PV conservé.
- **Le prêt se solde chaque exercice** (1135 = 0 au 31/12). Un prêt actionnaire qui
  roule sans intérêt ni échéance est requalifiable en **dividende déguisé** (dividen
  terselubung) — redressement + pénalités, et la retenue de 10 % devient due avec
  majorations. Documenter le prêt (convention écrite, plafond) même s'il vit moins
  d'un an.
- **La retenue se déclare et se reverse** : DR 2150 / CR 2115 PPh Payable au moment de
  la mise en paiement/compensation, reversement au calendrier DJP — un dividende « net
  de tout » sans retenue déclarée est une omission, pas une optimisation.

## Lignes rouges (jamais, même sur demande)

- Ventes hors POS / hors JE (« caisse noire »), minoration de la base PBJT, double
  billetterie.
- Dépenses personnelles déguisées en charges, factures de complaisance, anti-datage.
- Fractionnement artificiel de l'activité pour rester sous un seuil (PKP ou UMKM).
- Toute proposition qui ne survivrait pas à un contrôle Bapenda/DJP documents en main.

Si une demande touche une ligne rouge : refuser, expliquer, proposer l'alternative
légale la plus proche.

## Checklist de conformité continue (le socle avant toute optimisation)

- [ ] PB1 mensuelle : `get_pb1_report` du mois == somme reversée au Bapenda, à l'heure.
- [ ] Périodes fiscales closes mensuellement ; clôture annuelle exécutée (seede N+1).
- [ ] Zéro JE manuelle récurrente non expliquée (indice de flux non automatisé).
- [ ] Rapprochement bancaire 1112 vs relevés ; clearings 1115/1116 apurés (un solde qui
  gonfle = encaissements non rapprochés).
- [ ] Justificatifs expenses complets (le module les exige — vérifier qu'ils restent
  accessibles).
- [ ] Si le bloc immobilisations est actif : registre des actifs à jour, dotations
  mensuelles passées, aucun solde orphelin en 1590 après cession.
- [ ] Si le levier prêt actionnaire est actif : 1135 soldé au 31/12, PV RUPS conservé,
  retenue 2115 reversée.
