# Audit design POS — payment (CAISSE) — 2026-06-25

## 1. Synthèse

- **Périmètre audité** : l'écran de **paiement** de la CAISSE uniquement (desktop/Tauri, rush) — la modale plein-écran `PaymentTerminal` et tous ses sous-composants de présentation : `OrderSummaryPanel` (colonne gauche), `PaymentMethodGrid`, `QuickPayRow`, `TenderDraftPanel`, `RetryBanner`, le footer CTA, plus le `SuccessModal` (confirmation/monnaie) et l'entrée du `SplitPaymentFlow`. Profil unique : CAISSE. (Pas de profil WAITER : la prise de commande tablette encaisse via un autre chemin — hors périmètre demandé.)
- **Verdict (3-5 lignes)** : l'écran de paiement est **soigné et déjà mature** (4/5). Les cibles tactiles sont généreuses (tuiles méthode `h-24`=96px, CTA `size="lg"`=`h-touch-large`=80px, numpad `h-touch-comfy`=56px), la couverture d'états est excellente (retryable / already-paid / fatal en bannières persistantes), la hiérarchie du total et de la monnaie-à-rendre est nette, et le fast-path « Cash Exact » évite le numpad sur le geste le plus fréquent. **Faiblesse dominante** : la **densité d'interaction de la saisie de montant** — dès qu'on quitte le fast-path (méthode non-cash, ou cash non-exact), le caissier doit sélectionner une méthode, puis taper/choisir un montant, puis cliquer **Add Tender**, puis **Process Payment** : la vitesse chute alors que les 6 méthodes sont toutes au même poids visuel sans aucune pré-sélection de la méthode probable. **Le P0 à régler en premier** : la grille des 6 méthodes (`PaymentMethodGrid.tsx:18`) ne propose **aucune méthode pré-sélectionnée ni hiérarchisée** — Cash n'est pas mis en avant alors qu'il est la méthode dominante en boulangerie-café, ce qui coûte un tap inutile à chaque encaissement non-fast-path et noie la méthode probable au milieu de 6 tuiles équivalentes.

| Écran | Profil | Maturité (1-5) | Faiblesse dominante |
|---|---|---|---|
| Payment (terminal complet) | Caisse | 4 | Pas de méthode pré-sélectionnée / hiérarchisée ; quick-cash absent hors fast-path |
| — Grille méthodes | Caisse | 3 | 6 tuiles à poids égal, zéro pré-sélection, libellés `text-xs` |
| — Saisie montant (TenderDraftPanel) | Caisse | 3 | Quick-cash limité au cash + ≥ remaining ; flux Add Tender → Process en 2 temps |
| — Quick-pay row | Caisse | 4 | Fast-path bien fait, mais placeholder « Select a method » occupe l'espace sans guider |
| — Order summary (gauche) | Caisse | 4 | Total répété, lisible ; rien de critique |
| — SuccessModal (monnaie) | Caisse | 5 | RAS — monnaie en hero `text-4xl` gold, état propre |

## 2. Constats détaillés (par sévérité)

| # | Sévérité | Écran | Profil | Constat (avec fichier:ligne) | Critère |
|---|---|---|---|---|---|
| 1 | P0 | Payment / méthodes | Caisse | Les 6 méthodes sont rendues à **poids visuel égal** sans pré-sélection ni ordre de priorité (`PaymentMethodGrid.tsx:18` grid-cols-3 ; `paymentMethods.ts:13` liste à plat). Cash, méthode dominante d'une boulangerie-café, n'est ni en tête ni mise en avant → 1 tap perdu à chaque encaissement non-fast-path + recherche visuelle dans 6 tuiles. | Vitesse (taps) / Ergonomie de rush |
| 2 | P0 | Payment / quick-cash | Caisse | Le **quick-cash** (presets billets : exact, 50k, 100k) n'apparaît **que dans `TenderDraftPanel`** (`TenderDraftPanel.tsx:70`), c.-à-d. **après** avoir sélectionné une méthode, et **uniquement en cash** (`isCashDraft && …`). Tant qu'aucune méthode n'est choisie, la zone quick-pay n'offre que « Select a method to proceed » (`QuickPayRow.tsx:45`). Le pattern « gros bouton montant probable » des leaders n'est pas surfacé au premier coup d'œil. | Ergonomie de rush / Vitesse |
| 3 | P1 | Payment / flux tender | Caisse | Encaissement non-fast-path = **2 actions séquentielles** : `Add Tender` (`TenderDraftPanel.tsx:89`, secondary) puis `Process Payment` (`PaymentTerminal.tsx:186`, primary) sur un paiement mono-tender. Pour un paiement simple à une seule méthode, l'étape « Add Tender » est une friction (le système sait déjà que remaining sera 0). | Vitesse (taps) |
| 4 | P1 | Payment / libellés méthode | Caisse | Libellé de méthode en `text-xs uppercase tracking-widest` (`PaymentMethodGrid.tsx:37`) dans une tuile de 96px de haut : icône 20px + texte 12px. La lisibilité « coup d'œil en rush » est portée surtout par l'icône ; le libellé est petit pour une tuile aussi grande. | Hiérarchie / Lisibilité |
| 5 | P2 | Payment / quick-pay placeholder | Caisse | Quand aucune méthode n'est choisie, `QuickPayRow` affiche un placeholder pointillé `text-text-muted text-xs` « Select a method to proceed » (`QuickPayRow.tsx:45`) qui **occupe la largeur du futur CTA** sans rien faire d'actionnable — espace mort sur le chemin chaud. | Densité / Hiérarchie |
| 6 | P2 | Payment / preset 50k/100k | Caisse | Les presets billets ne s'affichent que pour `q >= remaining` puis `.slice(0,4)` (`TenderDraftPanel.tsx:70`). Pour un total de 12 000 Rp, on ne voit que des coupures ≥ 12 000 ; aucune coupure « ronde au-dessus » garantie si les presets configurés ne couvrent pas bien la plage — dépend entièrement de `presets.quickPayments`. À vérifier visuellement sur petits montants. | Ergonomie de rush |
| 7 | P2 | Payment / Cancel footer | Caisse | Le footer met `Cancel` (variant secondary) et `Process Payment` (primary vert) côte à côte (`PaymentTerminal.tsx:181-200`). Sur un écran tactile en rush, Cancel à gauche du CTA final est un voisin tactile du geste irréversible ; OK en desktop souris mais à surveiller en tout-tactile. | Cibles tactiles (voisinage) |
| 8 | P3 | Payment / raccourcis clavier | Caisse | Aucun raccourci clavier (Entrée = Process, Échap = retour) n'est câblé visiblement dans `PaymentTerminal.tsx`. La caisse desktop/Tauri a un clavier physique : un caissier expérimenté gagnerait à valider au clavier sans viser le CTA. | Vitesse (saisie) |

> Note frontière : le câblage idempotence/retry (`RetryBanner` + `dispatchCheckout`) relève du **comportement** mais son rendu visuel (bannières persistantes vs toast) est ici jugé **excellent** — la correction fonctionnelle sous-jacente (versioning RPC, idempotency key) reste du ressort de `pos-flow-audit`, pas de cet audit.

## 3. Benchmark vs leaders (écran de paiement)

- **Méthode probable pré-sélectionnée** — Les leaders (`Square`, `Clover`) **pré-sélectionnent la méthode la plus probable** (souvent Cash ou la dernière utilisée) et la rendent dominante. Aujourd'hui Breakery affiche 6 tuiles `grid-cols-3` à poids égal sans pré-sélection (`PaymentMethodGrid.tsx:18-40`). Maturité **3/5**. Pattern à importer : **pré-sélectionner Cash par défaut** (ou la dernière méthode du shift) et/ou hiérarchiser la grille (Cash + Card en grand, les 4 autres en rangée secondaire). Utile surtout pour la CAISSE en rush.

- **Quick-cash visible d'emblée** — Les leaders (`Square`) exposent les **montants probables (exact, 50k, 100k)** comme gros boutons **dès l'entrée** dans l'écran de paiement, sans présélection de méthode. Breakery a un excellent fast-path « Cash Exact — Rp X » (`QuickPayRow.tsx:32-43`) mais les autres coupures (50k/100k) sont enfouies dans `TenderDraftPanel` après sélection de méthode (`TenderDraftPanel.tsx:70`). Maturité **3/5**. Pattern à importer : remonter une **rangée quick-cash (Exact · coupure ronde supérieure)** au niveau de `QuickPayRow`, pré-cash, pour couvrir le cas « le client paie en billet rond » en 1 tap.

- **Split bill / split tender** — Les leaders (`Toast`, `Lightspeed`) offrent le split par convive et le split tender. Breakery couvre **déjà très bien** ce besoin : `SplitPaymentFlow` (mode_select → equal / items / custom, un tender par payeur — `SplitPaymentFlow.tsx:6-21`) + multi-tender accumulé via `TenderListBuilder` (`PaymentTerminal.tsx:122-135`). Maturité **5/5**. Rien à importer — Breakery est au niveau de référence ici.

- **Confirmation + monnaie en grand** — Les leaders (`Square`, `Clover`) affichent la **monnaie à rendre en très grand**, lisible par le client. Breakery fait exactement ça : `SuccessModal` rend « Change to give » en `text-4xl` mono gold dans un bloc dédié (`SuccessModal.tsx:154-167`), masqué pour card/QRIS. Maturité **5/5**. Aucun delta.

- **Gros boutons méthode** — Les leaders (`Clover`, `Square`) utilisent de gros boutons méthode reconnaissables. Breakery a des tuiles `h-24` (96px) avec icône — taille **au-dessus** du standard, c'est une force. Seul bémol : le libellé `text-xs` (`PaymentMethodGrid.tsx:37`) est petit relativement à la tuile. Maturité **4/5**.

## 4. Recommandations priorisées

### CAISSE

### [P0] Pré-sélectionner et hiérarchiser la méthode de paiement
**Profil** — caisse.
**Écran** — `PaymentMethodGrid` (`apps/pos/src/features/payment/components/PaymentMethodGrid.tsx:18-40`) + liste `paymentMethods.ts:13` + sélection initiale dans `usePaymentFlowLogic.ts:42-43`.
**Problème** — Les 6 méthodes sont rendues à poids visuel strictement égal, sans pré-sélection ni ordre de priorité. En boulangerie-café le cash domine ; le caissier doit pourtant scanner 6 tuiles et taper la sienne à chaque encaissement non-fast-path. Un tap + une recherche visuelle perdus à chaque commande.
**Proposition** — Pré-sélectionner **Cash** par défaut à l'ouverture du terminal (initialiser `selectedMethod='cash'` dans le store de paiement / `usePaymentFlowLogic`), ce qui rend immédiatement le fast-path « Cash Exact » et le numpad cash actifs. Optionnellement, hiérarchiser la grille en deux rangées : Cash + Card en tuiles pleine largeur (`col-span` plus large), QRIS/EDC/Transfer/Store Credit en rangée secondaire plus compacte. Garder l'état `active` gold existant (`border-gold bg-gold-soft`).
**Référence marché** — Square/Clover pré-sélectionnent la méthode probable et la rendent dominante : zéro tap pour le cas modal.
**Stack** — Aucun nouveau primitif. Modifier l'init de `selectedMethod` (store), réutiliser `grid` Tailwind avec `col-span-*`, tokens `border-gold`/`bg-gold-soft` déjà en place.
**Effort / Impact** — S × fort.
**Critère d'acceptation** — À l'ouverture du terminal, Cash est visuellement actif (cadre gold) et le bloc fast-path/numpad cash est immédiatement disponible sans aucun tap sur la grille.

### [P0] Surfacer le quick-cash (exact + coupures rondes) avant la sélection de méthode
**Profil** — caisse.
**Écran** — `QuickPayRow` (`apps/pos/src/features/payment/components/QuickPayRow.tsx:31-59`) + presets dans `TenderDraftPanel.tsx:70` + `quickAmounts` (`usePaymentFlowLogic.ts:57`).
**Problème** — Les coupures rondes (50k/100k) ne sont accessibles qu'après avoir choisi une méthode, dans `TenderDraftPanel`. Tant qu'aucune méthode n'est choisie, `QuickPayRow` n'affiche qu'un placeholder mort « Select a method to proceed ». Le client qui paie en billet rond impose au caissier : choisir Cash → trouver la coupure → Add Tender → Process. Plusieurs taps là où Square en demande un.
**Proposition** — Étendre `QuickPayRow` (ou ajouter une rangée pré-méthode) avec **2-3 gros boutons cash** : « Exact (Rp total) » et les 1-2 coupures rondes immédiatement supérieures issues de `quickAmounts`. Un tap pré-sélectionne Cash, remplit `cashReceivedStr`, et arme `Process Payment` (réutiliser la logique `fastPathReady` qui gère déjà `isCashDraft && draftAmount >= total`). Conserver le bouton vert « Cash Exact » actuel comme l'un de ces boutons.
**Référence marché** — Square : quick-cash visible d'entrée, le geste « billet rond » se règle en 1 tap.
**Stack** — Réutiliser `formatLabel` (`format.ts`), `quickAmounts` déjà calculés, classes `h-14 bg-green` déjà présentes dans `QuickPayRow`. Pas de nouveau token.
**Effort / Impact** — M × fort.
**Critère d'acceptation** — Sans avoir touché la grille de méthodes, le caissier voit « Exact », « 50 000 », « 100 000 » ; un tap sur l'un arme le CTA Process (monnaie affichée le cas échéant).

### [P1] Fusionner « Add Tender » + « Process » pour un paiement mono-tender
**Profil** — caisse.
**Écran** — `TenderDraftPanel` bouton Add Tender (`TenderDraftPanel.tsx:89-98`) + footer Process (`PaymentTerminal.tsx:186-200`) + logique `fastPathReady`/`canProcess` (`usePaymentFlowLogic.ts:84-92`).
**Problème** — Sur un paiement à une seule méthode et montant suffisant, le caissier fait Add Tender puis Process : deux gestes pour une intention unique. Le système sait déjà que `remaining` deviendra 0.
**Proposition** — Quand le draft courant couvre exactement le `remaining` **et** qu'aucun tender n'est encore accumulé, transformer « Add Tender » en CTA terminal direct (« Process Payment ») — étendre `fastPathReady` à toutes les méthodes (pas seulement le cash exact) ou faire enchaîner `handleAddTender` → `handleProcess` quand `draftTenderAmount === remaining && tenders.length === 0`. Garder Add Tender visible uniquement quand un split multi-tender est en cours (`remaining > draftTenderAmount`).
**Référence marché** — SumUp/Square : encaissement mono-méthode en un minimum d'écrans, pas d'étape « ajouter » superflue.
**Stack** — Logique pure dans `usePaymentFlowLogic`, réutilise `validateTenders` + `dispatchCheckout` existants. Aucun composant nouveau.
**Effort / Impact** — M × moyen.
**Critère d'acceptation** — Un paiement carte montant exact se solde en : choisir Card (ou pré-sélectionné) → Exact → 1 CTA, sans bouton « Add Tender » intermédiaire.

### [P1] Agrandir le libellé de méthode dans les tuiles
**Profil** — caisse.
**Écran** — `PaymentMethodGrid.tsx:37`.
**Problème** — Tuile de 96px avec libellé `text-xs` (12px) : la lisibilité au coup d'œil repose presque entièrement sur l'icône, sous-exploitant la grande tuile.
**Proposition** — Passer le libellé à `text-sm` (voire `text-base`) en gardant `uppercase tracking-wide`, et l'icône à `h-6 w-6`. Conserver `gap` et centrage. Pur ajustement d'échelle, aucun risque de débordement (libellés courts).
**Référence marché** — Clover/Square : libellé méthode lisible sans dépendre uniquement de l'icône.
**Stack** — Classes Tailwind uniquement.
**Effort / Impact** — S × moyen.
**Critère d'acceptation** — Le nom de la méthode est lisible à distance bras tendu sans plisser les yeux ; l'icône reste secondaire.

### [P2] Remplacer le placeholder mort de QuickPayRow par une zone utile
**Profil** — caisse.
**Écran** — `QuickPayRow.tsx:44-48`.
**Problème** — Quand aucune méthode n'est sélectionnée, l'emplacement du futur CTA est occupé par un encart pointillé « Select a method to proceed » non actionnable — de l'espace mort sur le chemin chaud.
**Proposition** — Une fois la P0 quick-cash livrée, ce placeholder disparaît naturellement (les boutons quick-cash arment Cash). Sinon, y placer directement les boutons quick-cash. Éviter tout encart purement informatif sur le chemin chaud.
**Référence marché** — Square : pas d'état d'attente sur l'écran de paiement, toujours une action sous le doigt.
**Stack** — Tailwind ; dépend de la P0 quick-cash.
**Effort / Impact** — S × faible (absorbé par la P0).
**Critère d'acceptation** — Aucun encart non-actionnable n'occupe la zone CTA dans l'état initial du terminal.

### [P2] Espacer Cancel du CTA Process dans le footer
**Profil** — caisse.
**Écran** — `PaymentTerminal.tsx:181-200`.
**Problème** — `Cancel` (secondary) et `Process Payment` (primary vert, action irréversible) sont aux deux extrémités du footer mais sur la même rangée tactile ; en exploitation tout-tactile, un risque de mis-tap près du geste final.
**Proposition** — Conserver Cancel à gauche (variant secondary, déjà discret) mais garantir un grand vide entre les deux (déjà `justify-between`) et envisager de réduire la largeur de la zone tactile de Cancel ou de le déplacer dans le header (`Back to Cart` existe déjà en haut — `PaymentTerminal.tsx:84`). Possiblement supprimer le `Cancel` du footer puisque le header offre déjà retour + close.
**Référence marché** — Clover : l'action irréversible est isolée des actions d'annulation.
**Stack** — Tailwind / réorganisation JSX. Aucun primitif nouveau.
**Effort / Impact** — S × faible.
**Critère d'acceptation** — Le CTA Process n'a pas d'action destructive/annulation comme voisin tactile immédiat.

### [P3] Raccourcis clavier (Entrée = Process, Échap = retour)
**Profil** — caisse.
**Écran** — `PaymentTerminal.tsx` (niveau modale).
**Problème** — La caisse desktop/Tauri a un clavier physique mais l'écran est 100% pointé ; un caissier rapide ne peut pas valider au clavier.
**Proposition** — Câbler un `onKeyDown` au niveau de `FullScreenModal` : Entrée déclenche `handleProcess` si `canProcess`, Échap appelle `close`. Ne pas capter les chiffres (le numpad virtuel + clavier physique alimentent déjà `cashReceivedStr` via l'input).
**Référence marché** — POS desktop pros (Revel) : raccourcis clavier pour les caissiers à haute cadence.
**Stack** — Hook `useEffect` + `window`/`ref` listener, garde `canProcess` existante. Aucun primitif nouveau.
**Effort / Impact** — M × faible (gain pour power-users seulement).
**Critère d'acceptation** — Entrée valide le paiement quand le CTA est actif ; Échap revient au panier.

> *(Section WAITER omise : l'écran de paiement audité est exclusivement CAISSE. La prise de commande tablette n'encaisse pas via `PaymentTerminal` — hors périmètre de cette demande mono-écran.)*

## 5. Quick wins (effort S, impact ≥ moyen)

- **[P0] Pré-sélectionner Cash** à l'ouverture du terminal (init `selectedMethod='cash'`) — 1 tap économisé par encaissement, effort S. (ticket P0 #1)
- **[P1] Libellés méthode `text-sm` + icône `h-6 w-6`** (`PaymentMethodGrid.tsx:37`) — lisibilité rush, effort S. (ticket P1 #4)
- **[P2] Supprimer le placeholder « Select a method »** au profit des quick-cash / ou retirer l'encart mort (`QuickPayRow.tsx:45`) — effort S. (ticket P2 #5)
- **[P2] Sortir `Cancel` du footer** (le header a déjà Back + Close) pour isoler le CTA irréversible (`PaymentTerminal.tsx:182`) — effort S. (ticket P2 #7)
