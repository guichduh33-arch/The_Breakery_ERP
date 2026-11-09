---
target: Stock alerts (archetype List)
total_score: 17
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
timestamp: 2026-08-08T16-31-26Z
slug: apps-backoffice-src-pages-inventory-alertspage-tsx
---
Method: dual-agent (A: design review · B: détecteur + preuve mécanique)

## Design Health Score

| # | Heuristique | Score | Trouvaille clé |
|---|---|---|---|
| 1 | Visibilité de l'état du système | 2 | `ProductionAlertsTab.tsx:78-79` n'a aucune branche d'erreur : une RPC en échec s'affiche « Nothing to produce ». Aucun indicateur de fraîcheur malgré `staleTime: 60_000` (`useLowStock.ts:33`). |
| 2 | Correspondance système / monde réel | 2 | Un quart de l'écran est en français (`ConfigIssuesTab.tsx:20-37`). « Lookback » / « Buffer » (`ReorderTab.tsx:93,106`) sont des termes d'analyste. Shortfall à 3 décimales (`LowStockTab.tsx:53`). |
| 3 | Contrôle et liberté | 1 | Aucune action sur l'écran. Onglet actif en `useState` (`AlertsPage.tsx:59`) : non partageable, perdu au rechargement. Réglages volatils (`ReorderTab.tsx:83-84`). |
| 4 | Cohérence et standards | 2 | 4 divergences structurelles sur 5 avec l'archétype List. Traitement d'onglet contredisant `ProductsPageTabs.tsx:35`. Rampe typo inventée : 22 littéraux hors rampe sur 6 fichiers. |
| 5 | Prévention des erreurs | 2 | `Number(e.target.value) || 30` (`ReorderTab.tsx:101`) fait remonter le champ à 30 dès qu'on le vide. Aucun debounce : chaque frappe déclenche une RPC. |
| 6 | Reconnaissance plutôt que rappel | 2 | `TabCount` disparaît à zéro (`AlertsPage.tsx:42`) : « 0 à réapprovisionner » et « pas encore chargé » sont indistinguables. |
| 7 | Flexibilité et efficience | 1 | Aucune colonne `sortable` alors que `DataTable` l'implémente (`DataTable.tsx:44,189-200`). Pas de recherche, de filtre, d'export, de raccourci, d'état d'URL. |
| 8 | Esthétique et minimalisme | 2 | Deux retranchements justes (`AlertsPage.tsx:10-13`, `:116-117`) annulés par l'aplat doré de l'onglet actif et le Playfair italique des états vides. |
| 9 | Reconnaître et récupérer les erreurs | 1 | Trois traitements différents, aucun retry, message PostgREST brut exposé (`LowStockTab.tsx:62-64`, `ReorderTab.tsx:123-125`, `ConfigIssuesTab.tsx:107-109`). |
| 10 | Aide et documentation | 2 | La note de formule (`ReorderTab.tsx:118-120`) et les hints de Config sont de la vraie aide contextuelle, mais aucun hint ne renvoie vers l'écran qui corrigerait le problème. |
| **Total** | | **17/40** | **Poor — refonte UX majeure requise** |

Aucune heuristique n'est `n/a` : l'écran est en mode **Operate**, les heuristiques 7 et 10 s'y appliquent pleinement.

## Design Specificity Verdict

**Évaluation LLM (non ancrée).** Cette composition n'est pas issue de ce produit. C'est un *tabbed table dashboard* générique, transposable tel quel dans n'importe quel SaaS d'inventaire. Le test est mécanique : remplacez les libellés de colonnes de `LowStockTab.tsx:22-57` par des noms de tickets, rien dans la structure ne proteste.

Le verdict est aggravé par le fait que le dépôt contient déjà une instance List construite (Products), et que Stock alerts en diverge sur **quatre invariants d'archétype sur cinq** :

| Invariant List (`DESIGN.md` § Page Archetypes) | Products | Stock alerts |
|---|---|---|
| Fil d'Ariane 12 px (ossature commune) | `ProductsHeader.tsx:36-40` | **absent** |
| Actions 32 px à droite du bandeau | `ProductsHeader.tsx:49-55` | **absent** (`PageHeader` appelé sans `actions`, `AlertsPage.tsx:94`) |
| Bande de compteurs **qui sont** les filtres | `ProductsCounterStrip.tsx:38-87` | **absent**, retiré volontairement |
| Dernière colonne = action de ligne | `ProductsTable.tsx:230-233` | **absent des quatre tables** |
| Sélection → action groupée dans le bandeau | — | **absent** |
| Pied toujours rendu | ✓ | ✓ (`DataTable.tsx:288-292`) |

Un seul invariant tenu. La page a **zéro action** : un écran nommé « alerts » qui ne permet aucune réponse à l'alerte n'est pas un instrument, c'est un afficheur.

Trois violations frontales de Named Rules de `DESIGN.md` :
- **One Ink Fill** — aucune surface encrée sur la page, donc aucun poids. Le déficit total (`AlertsPage.tsx:90`), seule mesure transverse, est enterré dans une phrase en sans-serif.
- **Ink-Not-Gold + Border-Before-Shadow** — l'onglet actif est un aplat doré avec bordure or, texte or et ombre (`Tabs.tsx:29`), quatre encodages redondants du même état sur un élément qui ne flotte pas. Le traitement canonique existe dans le dépôt : soulignement or 2 px + poids (`ProductsPageTabs.tsx:35`).
- **Playfair-Is-Brand-Only** — `EmptyState.tsx:152` rend tout titre d'état vide en `font-display italic`, soit Playfair (`packages/ui/src/tokens/typography.css:22`). L'état nominal d'une boulangerie saine — quatre tables vides — s'habille du signal « vitrine artisanale » que la refonte du 2026-08-05 a explicitement retiré.

**Scan déterministe.** Exit code 2, **17 trouvailles, une seule règle** : `design-system-font-size`, 17/17 **réelles, zéro faux positif**. Rampe d'autorité = {10, 11, 14, 16, 23, 26} px, tolérance ±0,5 px. Valeurs fautives : 12 px (`ConfigIssuesTab.tsx:70`), 13 px (`ProductCell.tsx:25`), et 12,5 px ×15 réparties sur `LowStockTab`, `ReorderTab`, `ProductionAlertsTab`, `ConfigIssuesTab`. Zéro trouvaille sur `AlertsPage.tsx`, `PageHeader.tsx`, `AlertsBadge.tsx`.

Le détecteur a **5 angles morts** mécaniquement établis, sous la tolérance de ±0,5 px : `text-[10.5px]` (`AlertsPage.tsx:46`, `ProductCell.tsx:30`, `ReorderTab.tsx:73`, `ReorderTab.tsx:118`) et `text-[11.5px]` (`ConfigIssuesTab.tsx:79`). Total réel : **22 littéraux hors rampe sur 6 fichiers, 7 corps distincts** là où la rampe en déclare 6 dont 3 seulement dans cette plage. La prose de `DESIGN.md` (§ Layout) documente d'ailleurs la densité compacte à « 14/10 px » — la déviation vaut donc contre les deux sources.

Le sidecar `.impeccable/design.json` **ne contient aucune valeur `fontSize`** : le détecteur alimente sa rampe depuis le frontmatter de `DESIGN.md` seul. La péremption du sidecar signalée par `doctor` est donc sans effet sur ces 17 trouvailles.

Un `#rrggbb` en dur : **aucun** dans le périmètre. En revanche `AlertsBadge.tsx:41` utilise `text-white`, palette Tailwind par défaut et non un token du thème — le détecteur ne couvre pas les noms de classes utilitaires.

**Overlays visuels : aucun.** L'inspection navigateur n'a pas eu lieu — la route est gardée par `PermissionGate required="inventory.read"` (`routes/index.tsx:382-388`) derrière `/login`. L'atteindre exigerait de fabriquer des credentials ou de contourner le garde. Aucun serveur démarré, aucun script injecté, aucune observation de rendu dans ce rapport. Trois points restent donc non tranchés : le contraste réel de `text-gold` sur `bg-gold-soft` empilé, le comportement à 768 px des tables à six colonnes, et la lisibilité effective du barré à 11,5 px.

## Overall Impression

L'écran diagnostique correctement et ne permet rien. C'est un fait unique et structurant : les heuristiques 3 (contrôle), 7 (flexibilité) et 9 (récupération) s'effondrent toutes les trois pour cette seule raison. Le travail de refonte du 2026-08-08 a été fait sur la moitié « retranchement » — les suppressions sont justes et argumentées — et pas du tout sur la moitié « archétype » : ni fil d'Ariane, ni actions de bandeau, ni action de ligne, ni sélection.

**La plus grande occasion :** l'archétype List existe, il est écrit, et une instance conforme est déjà dans le dépôt. Il n'y a rien à inventer — il y a à appliquer.

## What's Working

1. **Le compte est chargé au niveau de la page pour les quatre onglets, y compris non montés** (`AlertsPage.tsx:61-64`), avec la raison écrite : « un onglet dont on ne voit pas le compte tant qu'on ne l'a pas ouvert n'attire l'attention sur rien » (`:17-20`). Sur un écran d'alertes, l'urgence doit être visible avant la navigation. Coût nul, react-query dédoublonnant par clé.
2. **Les suppressions sont argumentées et correctes.** La rangée de trois tuiles à icônes a sauté parce que « deux de ses trois mesures répétaient déjà un onglet, et la troisième n'était pas une mesure mais une phrase déguisée en chiffre » (`AlertsPage.tsx:10-13`). Les tables ne sont pas enveloppées dans une carte parce qu'elles portent déjà leur bordure (`:116-117`).
3. **`ProductCell` a été extrait pour une raison de fond, pas de DRY** : « le SKU est une DONNÉE, il doit rendre en mono tabulaire, et une règle qui vit à quatre endroits finit par ne plus valoir qu'à trois » (`ProductCell.tsx:6-8`). C'est The Mono-Carries-Data Rule transformée en contrainte structurelle.

## Priority Issues

### [P0] L'écran ne permet aucune action : ni colonne d'action, ni sélection, ni action groupée

Les quatre tables se terminent sur une colonne de données (`LowStockTab.tsx:48-56`, `ReorderTab.tsx:66-79`, `ProductionAlertsTab.tsx:62-74`, `ConfigIssuesTab.tsx:92-101`). Aucune case à cocher, aucun bouton de ligne, `PageHeader` appelé sans `actions` alors que la prop existe (`PageHeader.tsx:28,64`).

**Pourquoi ça compte.** Le responsable stock voit « 12 à réapprovisionner, fournisseur X, 40 kg », doit tout mémoriser, quitter la page, ouvrir Purchase orders, ressaisir. Sur les sessions courtes et interrompues décrites par `PRODUCT.md`, la traduction du diagnostic en acte ne survit pas à l'interruption. Et la donnée nécessaire est déjà là : `get_reorder_suggestions_v1` remonte `supplier_id` et `supplier_name` (`useReorderSuggestions.ts:17-18`), jetés à l'écran.

**Fix.** Une colonne d'action terminale par onglet (Receive / Add to PO / Log batch / Fix in product), plus une colonne de sélection sur Reorder et Production alimentant une action groupée annoncée dans le bandeau via `PageHeader actions` — ce qui donne du même coup à la page l'unique surface encrée que One Ink Fill lui autorise et qu'elle n'utilise pas.

**Commande :** `/impeccable shape` (le geste d'action n'existe pas encore, il se conçoit avant de se coder), puis `/impeccable layout`.

### [P0] Un quart de l'écran est en français, dans un produit dont la langue d'interface est l'anglais

`AlertsPage.tsx:111` (« Config produit ») et l'intégralité de `ConfigIssuesTab.tsx` : 4 titres de problème et 4 hints (`:20-37`), en-têtes de colonnes (`:55, 60, 77, 87`), état vide (`:120-121`), pied (`:125`). **17 occurrences sur 2 fichiers.**

**Pourquoi ça compte.** `PRODUCT.md` pose l'anglais comme choix durable confirmé, sans couche i18n. La rupture rend l'onglet illisible pour trois des quatre profils, et fait passer les libellés de sévérité pour des chaînes de debug.

**Commande :** `/impeccable clarify`.

### [P1] Le compte de l'onglet Reorder et sa table peuvent afficher deux vérités contradictoires simultanément

La page appelle `useReorderSuggestions(30, 14)` en dur (`AlertsPage.tsx:62`) pour `counts.reorder`, l'onglet appelle `useReorderSuggestions(lookback, buffer)` avec son état local (`ReorderTab.tsx:83-85`). Les clés react-query diffèrent (`useReorderSuggestions.ts:34`). Dès que l'utilisateur passe le buffer à 21, le badge affiche le compte pour 30/14 et la table celui pour 30/21.

**Pourquoi ça compte.** Deux nombres contradictoires pour la même chose, à 40 px l'un de l'autre, sur un écran dont le rôle est de dire combien de choses pressent. Atteinte directe au Principe 1 de `PRODUCT.md` (« Ce que l'interface montre est un reflet, jamais une source »).

**Fix.** Remonter `lookback`/`buffer` dans `AlertsPage` ou dans les paramètres d'URL — ce qui règle du même coup la persistance de l'onglet actif.

**Commande :** `/impeccable harden`.

### [P1] Les comptes d'onglet sont `aria-hidden` et n'existent que par la couleur

`TabCount` porte `aria-hidden` (`AlertsPage.tsx:51`) et son unique différenciateur sémantique est une classe de couleur (`:46-49`). Il retourne `null` à zéro (`:42`).

**Pourquoi ça compte.** Un lecteur d'écran annonce quatre onglets rigoureusement indifférenciés, alors que toute l'information d'urgence de la page tient dans ces quatre nombres. Pour un utilisateur voyant, la gravité est portée uniquement par la teinte (WCAG 1.4.1) — et deux onglets sur quatre partagent le même `warning`, donc la couleur ne discrimine même pas. Second défaut de même nature : `ConfigIssuesTab.tsx:46-49` encode l'état « désactivé » d'un drapeau par `line-through` seul, sans équivalent textuel.

**Commande :** `/impeccable harden`.

### [P1] Aucun état d'erreur exploitable, et une erreur qui se déguise en succès

`ProductionAlertsTab.tsx:78-79` n'a pas de branche d'erreur : une RPC en échec se rend comme « Nothing to produce », et l'`emptyDescription` (`:89`) confond explicitement les deux — « Either nothing needs production today, or the production module is not deployed ». Les trois autres onglets affichent un `<p>` rouge nu qui remplace la table, exposant le message PostgREST brut, sans retry.

**Pourquoi ça compte.** « Rien à produire » et « je n'ai pas pu lire la production » conduisent à des décisions opposées au fournil, et le coût de l'erreur est une fournée manquante. Un message d'erreur sans reprise transforme une coupure réseau de boutique — anticipée par `PRODUCT.md` — en cul-de-sac.

**Fix.** Un composant d'erreur unique pour les quatre onglets, conservant le chrome de la table, message métier + bouton Retry branché sur `refetch`. La RPC manquante est déjà détectée en amont (`useProductionSuggestions.ts:42`) : il suffit de remonter l'information au lieu de la noyer dans un `return []`.

**Commande :** `/impeccable harden`.

### [P2] 22 littéraux typographiques hors rampe, l'aplat doré de l'onglet actif, et le Playfair des états vides

Les 17 trouvailles du détecteur + 5 sous tolérance (détail au verdict). Plus `Tabs.tsx:29` (aplat + bordure + texte + ombre en or) et `EmptyState.tsx:152` (Playfair italique). Ces deux derniers vivent dans `@breakery/ui`, donc **tout correctif y retombe sur le POS** — à traiter comme chantier de propagation, pas comme fix local.

**Commande :** `/impeccable typeset`.

## Persona Red Flags

**Alex — power user (le propriétaire-gérant, session longue, densité forte)**
- Aucune colonne `sortable` sur les quatre tables, alors que `DataTable` implémente le tri avec `aria-sort` (`DataTable.tsx:44,173-181,189-200`). Il ne peut pas reclasser Reorder par fournisseur pour grouper une commande — `supplier_name` est pourtant là.
- `useState('low')` (`AlertsPage.tsx:59`) : impossible de garder « Stock alerts → Reorder » en favori ou de l'envoyer au manager.
- Aucun export dans le bandeau alors que le back-office dispose de `ExportButtons`. Sa sortie de secours reste le tableur — exactement ce que `PRODUCT.md` pose comme critère d'échec.
- Le badge de la top bar ment sur cette page : `AlertsBadge.tsx:19` somme low + reorder seulement. Il clique « 12 » et atterrit sur une page qui totalise low + production + config. Le détail n'est accessible que par un attribut `title` (`:38`) — inaccessible au clavier, absent au tactile.

**Sam — dépendant de l'accessibilité**
- Les quatre onglets sont indistinguables au lecteur d'écran (`AlertsPage.tsx:51`). Le sous-titre ne compense que Low stock.
- Le seul chemin d'action de chaque ligne est invisible au repos : `ProductCell.tsx:25` rend le lien en `text-text-primary` sans soulignement, l'or n'arrivant qu'au survol — alors que `DESIGN.md` assigne l'or aux liens. Au clavier ou sur tablette, le lien ne se signale pas.
- Trente lignes = trente arrêts de tabulation avant le pied, sans skip-link.
- La gravité passe par la seule couleur en trois endroits : `AlertsPage.tsx:46-49`, `ReorderTab.tsx:19-22`, `ConfigIssuesTab.tsx:97`.
- À conserver : l'anneau de focus `focus-visible:outline-2 outline-offset-2 outline-gold` (`ProductCell.tsx:25`) est conforme.

**Le responsable stock / production — debout, tablette, mains occupées, session interrompue**
- **Toutes les cibles tactiles sont sous 44 px.** Onglets ~28-32 px exploitables (`Tabs.tsx:14,29`) ; champs Lookback/Buffer à `h-8` = 32 px (`ReorderTab.tsx:15`) contre les 44 px que `DESIGN.md` impose aux champs ; lien produit à 13 px sans padding.
- `density="compact"` figé en dur sur les quatre onglets alors que `DESIGN.md` prévoit deux densités — bonne densité pour le bureau du gérant, mauvaise pour un doigt.
- Six colonnes sans défilement horizontal possible : `DataTable.tsx:160` est `overflow-hidden` sans `overflow-x-auto`. *(sévérité exacte non tranchée sans rendu à 768 px ; le fait de code est certain.)*
- Session interrompue = tout est perdu : onglet retombé sur Low stock, buffer retombé à 14.
- **Et surtout il ne peut rien enregistrer** — c'est le persona que le P0 frappe le plus fort. Il est physiquement devant le stock, l'information exacte à l'écran, et aucun moyen de déclarer une réception ou de lancer une fournée. Le ledger append-only rend pourtant ces gestes parfaitement sûrs à exposer : ce sont des écritures nouvelles, pas des corrections.

## Minor Observations

- `AlertsBadge.tsx:41` : `text-white` en dur (`DESIGN.md` interdit toute couleur en dur) et `rounded-full` sur une pastille, alors que le cercle complet est réservé à l'avatar et au point d'état.
- Pied de table « 12 products » (`LowStockTab.tsx:79-81`) sans dénominateur ; `DESIGN.md` demande le format « 0 sur 318 ».
- `ProductionAlertsTab.tsx:71` rend `{r.priority}` brut (`high`/`medium`/`low`) sans table de correspondance d'affichage.
- `ProductionAlertsTab.tsx:36` et `:59` affichent des quantités **sans unité**, là où Low stock et Reorder l'affichent systématiquement.
- Le sous-titre échappe à The Mono-Carries-Data Rule : trois chiffres de décision (`AlertsPage.tsx:90`) rendus en sans-serif par `PageHeader.tsx:59`, alors que `subtitle` accepte un `ReactNode` (`PageHeader.tsx:26,60-62`).
- `shortfall` arrondi à 2 décimales côté page (`AlertsPage.tsx:69`) puis affiché à 3 dans la colonne (`LowStockTab.tsx:53`).
- `gap-[13px]` (`AlertsPage.tsx:93`) est **intentionnel** — `DESIGN.md` documente « gouttière verticale de 13 px » — mais non tokenisé, donc invérifiable par outil et hors échelle `spacing`.
- `ConfigIssuesTab.tsx:64` fixe `max-w-md` en dur au lieu de la prop `width` prévue par `DataTable.tsx:47`.
- Aucun des quatre `staleTime: 60_000` n'est accompagné d'un indicateur de fraîcheur ni d'un bouton de rafraîchissement.

## Questions to Consider

1. **« Config produit » est-il une alerte, ou une dette de configuration ?** Trois onglets répondent à « qu'est-ce qui presse aujourd'hui », le quatrième à « qu'est-ce qui est mal réglé depuis six mois ». Sorti vers Settings ou un audit catalogue, il resterait trois onglets homogènes et le focus unique redeviendrait tenable.
2. **Faut-il seulement quatre onglets ?** Low stock, Reorder et Production répondent à une seule question déclinée par verbe : *ce produit manque — dois-je l'acheter ou le fabriquer ?* Une table unique triée par urgence, avec une colonne Action qui vaut « Order » ou « Produce », supprimerait la navigation, supprimerait le problème de comptes divergents, et donnerait enfin l'action de ligne que l'archétype exige. Les onglets ne sont-ils pas la trace d'un découpage par RPC plutôt que par décision ?
3. **Où est la tuile encre ?** Si « 3 produits à zéro » — le seul chiffre qui signifie une perte de vente en cours — occupait cette tuile en Display 26 px, l'écran répondrait en un regard à la question qu'on se pose en l'ouvrant.
4. **Que se passe-t-il quand tout va bien ?** L'état nominal, dans une boulangerie bien pilotée, c'est quatre tables vides. Aujourd'hui : quatre `EmptyState` en Playfair italique empilés dans quatre onglets.
5. **Pourquoi un écran d'alertes n'a-t-il aucune notion de temps ?** « Sous le seuil depuis 3 jours » distingue un pic ponctuel d'une dérive structurelle, et c'est cette distinction qui décide s'il faut commander ou revoir le seuil. Le ledger étant append-only, l'ancienneté d'une alerte est calculable.
6. **Un seuil qu'on ne peut pas régler depuis l'écran qui le viole, est-ce un seuil ou un reproche ?**
