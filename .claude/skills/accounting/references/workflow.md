# accounting — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Missions advisory (casquette senior)

## Missions advisory (casquette senior)

Chaque mission rend ses findings **en conversation** (jamais en fichier de rapport,
règle documentaire n°1) et toute proposition de changement passe par Mamat AVANT action.

### 1. Concevoir / faire évoluer le plan comptable

Méthode : lire le COA live → comparer au benchmark F&B même taille
(`references/coa-benchmark-fnb.md`) → classer chaque écart en (a) manque réel,
(b) choix assumé du projet, (c) doublon/résidu à neutraliser → proposer à Mamat, avec
pour chaque compte : code respectant les plages existantes, classe, `is_postable`,
`cash_flow_section` **explicite**, mapping éventuel. Jamais de création de compte sans
son usage émetteur identifié — un compte sans flux est un doublon dormant de plus.

### 2. Auditer la couverture des automatisations (zéro double saisie)

Point de départ : la « Carte des automatisations » du [modèle comptable](model.md). Vérifier que **tout
événement d'argent** (vente, remise, loyalty, avoir, B2B, achat, stock, dépense, écart
de caisse, coffres) a exactement un émetteur ; croiser
`SELECT DISTINCT reference_type FROM journal_entries` avec la carte ; toute JE manuelle
récurrente = un flux qui aurait dû être automatisé (finding). Tout mapping non résolu
par au moins une fonction live = candidat à la désactivation (finding, pas d'action).

### 3. Revoir structure, cohérence et lisibilité des pages

Standards attendus d'un module compta d'entreprise de cette taille : chiffres en
`tabular-nums`, IDR formaté locale id-ID, débits/crédits alignés à droite, totaux et
équilibrage visibles (badge balanced), drill-down JE → GL → pièce d'origine
(`resolveJeSourceEntity`), périodes/filtres persistants entre pages, exports CSV
UTF-8 BOM, terminologie unique (une seule façon de nommer « écriture », « période »,
« solde » dans toute la surface). Auditer contre `breakery-design` + `breakery-ui-kit` ;
findings en conversation, correctifs après accord.

### 4. Générer et vérifier les rapports comptables

Générer via les familles cockpit (`get_profit_loss`, `get_balance_sheet`,
`get_cash_flow`, `get_trial_balance`, `get_pb1_report`). **Aucun rapport n'est rendu
sans ses contrôles de cohérence** :
- Balance : `Σdebit = Σcredit` (flag `balanced`).
- Bilan : `assets = liabilities + equity` — et le résultat de la période dans equity
  correspond au net du P&L de la même période.
- Cash flow : `operating + investing + financing = cash_end − cash_start` au centime.
- P&L vs PB1 : `revenue 4100 × rate ≈ pb1_output` de la même période (écart = remises,
  B2B non taxé, dédup void/refund — l'expliquer, pas le masquer).
- Croiser deux sources quand elles existent (ex. valorisation stock vs soldes 114x).

### 5. Optimisation fiscale — légale uniquement

Cadre gravé : NON-PKP + PBJT (ADR-005, irrévocable). Leviers et méthode dans
`references/fiscal-optimization-nonpkp.md`. Principes non négociables :
- **La PB1 est un pass-through** collecté pour le Bapenda — elle ne s'« optimise » pas,
  elle se reverse juste et à l'heure.
- Le levier n°1 est la **capture exhaustive des charges légitimes** (une dépense non
  saisie = du résultat surtaxé), pas la minoration du revenu.
- Tout choix de régime (PPh final UMKM vs régime réel, statut juridique) = décision de
  Mamat avec un conseil fiscal local ; le skill prépare les chiffrages comparatifs.
- Rien qui déguise, anti-date, fractionne artificiellement ou omet un flux. Une
  optimisation qui ne survit pas à un contrôle Bapenda/DJP n'en est pas une.

---
