# Audit design POS 2026-07-07 — spec de correction (vagues A/B/C)

> **Date :** 2026-07-07 · **Branche proposée :** `swarm/session-67` (ou `fix/pos-design-audit` si session dédiée)
> **Source :** audit `/breakery-design` du 2026-07-07 — 4 auditeurs parallèles (tokens/thème, touch targets, états UI, typo/motion) + vérification au rendu réel (Playwright, viewport 1280×800, session CASHIER `EMP001`, mesures `getBoundingClientRect` + ratios WCAG calculés sur les couleurs computed).
> **Décompte findings :** 12 bloquants · ~14 incohérences · ~12 polish. Points forts confirmés (à ne pas casser) : reflex-path ≥ 44 px avec gardes anti-double-tap, hiérarchie Checkout>Send>ghosts, zéro hover-only révélateur, zéro couleur-seule-signal, `tabular-nums` via `Currency`, zéro Tailwind numéroté brut.
> **Périmètre DB :** UNE seule migration optionnelle (B7, RPC lecture pure). **Money-path v17/v11/fire_v4 non touchée** — les deux fixes « money-path » de la vague C sont des classes CSS de motion, pas de la logique.

## 0. Décisions à trancher avant exécution (propriétaire)

| # | Décision | Recommandation |
|---|---|---|
| D-a | **B7 presets caissier** : RPC dédié `get_pos_presets_v1` (migration) vs carve-out de la catégorie `pos_presets` dans `get_settings_by_category_v1` vs statu quo (fallback hardcodé) | RPC dédié lecture pure, gate `pos.sale.create` (miroir `useTaxRate`) |
| D-b | **Typo sous-échelle** : remonter tous les `text-[10px]`/`text-[9px]` à `text-xs` (11 px) vs créer un token canonique `--type-2xs` (10 px) pour les badges | Token `--type-2xs` pour les badges/pills, remontée à `text-xs` pour tout texte porteur d'info (dont `TableCell.tsx:84` à 9 px) |
| D-c | **`--text-muted` luxe-dark** : éclaircir la valeur du token (mesuré 3.35–3.51:1, requis 4.5:1). Touche POS + KDS + customer display + tablet (même thème). BO ivoire non concerné (token par thème) | Oui — choisir une valeur ≥ 4.6:1 sur `--surface-2` (`#18181b`), vérifier au navigateur sur POS **et** KDS |
| D-d | Inclure les polish (états `active:`, suppression des 5 composants orphelins, `Toggle` dupliqué, hints `title=`) dans la même branche ? | Oui pour orphelins + Toggle (dette morte) ; `active:` et hints en fin de vague C si le budget tient |

---

## Vague A — Layout (3 fixes, tous vérifiables au Playwright)

Bugs de rendu invisibles au grep, mesurés sur le viewport POS de référence **1280×800**.

### A1. Checkout tronqué (débordement horizontal de la barre d'actions)
- **Constat :** panier non vide → le bouton devient « Checkout Rp 40,000 » (269 px) et le groupe de droite pousse la toolbar à `scrollWidth` 1326 px pour 1265 px visibles : **61 px du CTA principal hors écran** + scrollbar horizontal parasite.
- **Fichier :** `apps/pos/src/features/cart/BottomActionBar.tsx` (groupe `Send to Kitchen` 181 px + `Checkout` non compressible).
- **Fix :** rendre le groupe de droite compressible (`min-w-0`, `shrink`, montant en `truncate` ou taille réduite du montant sous contrainte) et/ou raboter les paddings des ghosts de gauche. Aucun bouton du groupe ne descend sous sa hauteur actuelle (80 px).
- **Acceptance (Playwright) :** à 1280×800 avec 1 ligne au panier, `document.documentElement.scrollWidth <= clientWidth` et `checkoutRect.right <= innerWidth`.

### A2. Collision de cibles sur la ligne panier
- **Constat :** le conteneur du stepper fait 99 px mais son contenu 160 px : le « + » (56×56, x≈1111) est rendu **sous** « Apply discount » (44×44, x≈1114), qui chevauche aussi le prix. Taper « + » peut ouvrir la remise.
- **Fichier :** `apps/pos/src/features/cart/CartLineRow.tsx` (flex sans `min-w-0` maîtrisé dans le panneau 340 px).
- **Fix :** restructurer la ligne pour que stepper, bouton discount et prix aient chacun leur espace réel — 2 rangées (nom+prix / delete+stepper+discount) ou stepper compact 44 px. Delete (destructif) garde ≥ 8 px d'écart avec le stepper.
- **Acceptance (Playwright) :** aucune intersection entre les bounding boxes des boutons d'une ligne panier ; toutes les cibles ≥ 44 px.

### A3. Numpad cash sous la ligne de flottaison (terminal de paiement)
- **Constat :** la colonne droite du `PaymentTerminal` descend à y≈1011 pour 736 px utiles : rangées 7-8-9/0/C du numpad et « Add Tender » nécessitent un scroll **en pleine saisie d'espèces**.
- **Fichier :** `apps/pos/src/features/payment/PaymentTerminal.tsx` (colonne droite non contrainte à la hauteur du viewport).
- **Fix :** contraindre la colonne à `h-full` avec le numpad + Add Tender toujours visibles (compacter le bloc Total/Remaining, `text-4xl` → `text-3xl` — synergie C5, grille méthodes 2 rangées → scroll interne si besoin sur la seule zone méthodes).
- **Acceptance (Playwright) :** à 1280×800, mode cash actif, les 12 touches du numpad et « Add Tender » ont `rect.bottom <= innerHeight` sans scroll.

## Vague B — Silence & flux (états d'erreur, gate shift, presets)

Le primitif `ErrorState` existe déjà (`apps/pos/src/components/ErrorState.tsx`, copy FR + `onRetry`) — la vague consiste à l'utiliser + ajouter les `catch`/`onError` manquants. Modèle de mapping code→FR : `AttachTabCustomerButton.tsx:38-57`.

### B1. Gate shift au checkout (échec tardif)
- **Constat :** le terminal de paiement s'ouvre sans shift ; l'échec arriverait au `process-payment` final (`no_open_session`), client devant la caisse. `Pos.tsx:73-74` promet un re-trigger « via any cart action » mais `needsShift` (Pos.tsx:69) n'a aucun autre consommateur.
- **Fix :** avant d'ouvrir le PaymentTerminal (et sur Send to Kitchen), si `needsShift` → `setShiftAlertDismissed(false)` pour ré-afficher `ShiftClosedState` au lieu d'ouvrir le flux. Aucune modif serveur.

### B2. HeldOrdersModal honnête
- `HeldOrdersModal.tsx:151` : consommer `isError` de `useHeldOrdersQuery` → `<ErrorState onRetry={refetch} />` (aujourd'hui : erreur ⇒ « No orders held », risque de re-saisie en double).
- `:168-201` : `onError` toast FR sur restore/reopen/discard (aujourd'hui silencieux) + boutons désactivés pendant `isPending` (anti double-tap).

### B3. ComboConfigModal débloquée
- `ComboConfigModal.tsx:92,151` : extraire `isError`/`refetch` de `useComboConfig` → `ErrorState` (aujourd'hui : « Loading… » perpétuel sur erreur).

### B4. `ErrorState` dans les 4 vues-listes à texte mort
- `OrderHistoryPanel.tsx:165` · `CustomerDebtsPanel.tsx:99` · `POSStockView.tsx:243-245` · `LiveSessionsModal.tsx:90` → remplacer la phrase rouge par `<ErrorState onRetry={() => void query.refetch()} />` (pattern `ProductGrid`).

### B5. Recherche & création client non silencieuses
- `Pos.tsx:104-114` et `AttachTabCustomerButton.tsx:26-36` : ne plus ignorer `error` du RPC `search_customers_v3` (throw).
- `CustomerAttachModal.tsx:272-287` : `catch` sur `searchFn` → ligne « Recherche indisponible — réessayez » (au lieu de « 0 résultat » ⇒ création de doublons).
- `CustomerAttachModal.tsx:289-304` : `catch` sur `handleCreate` → `toast.error` FR (aujourd'hui : échec de création invisible).

### B6. Copy d'erreur FR-caissier
- Étendre le mapping code→FR aux fautifs : `OrderHistoryPanel.tsx:279-311` (`Cannot void: ${code}`), `ActiveOrderPanel.tsx:253-255`, `POSStockView.tsx:102-161` (`…échouée: ${code}`). Util partagée locale (pas de nouveau package).

### B7. Presets POS pour les caissiers (SEUL item DB — cf. D-a)
- **Constat :** `usePOSPresets.ts:94` appelle `get_settings_by_category_v1` (gate `settings.read`) → **403 pour CASHIER**, fallback hardcodé silencieux (`:117`) : les quick-payments/presets d'ouverture configurés au BO ne s'appliquent jamais en caisse + 403 en console à chaque boot.
- **Fix recommandé :** RPC **`get_pos_presets_v1`** SECURITY DEFINER STABLE, lecture pure des 3 clés `pos_presets`, gate `has_permission(auth.uid(), 'pos.sale.create')`, trio S20 (REVOKE PUBLIC+anon, GRANT authenticated, COMMENT). Migration au prochain numéro libre du NAME-block (vérifier `supabase/migrations/`, ≥ `_121`), corps de référence repris du **live** (règle DEV-S57-02). `usePOSPresets` repointé ; le fallback reste en dernier filet. Types regénérés + commit.
- **Test :** pgTAP léger (caissier lit, anon 42501) + vérification manuelle console POS sans 403.

## Vague C — Tokens, typo, motion, touch (mécanique, sweep)

### C1. Contraste du token muted (cf. D-c)
- `packages/ui/src/tokens/luxe-dark.css` : éclaircir `--text-muted` (actuel ≈ `rgb(107,107,115)`, mesuré 3.35:1 sur `--surface-2`) vers ≥ 4.6:1. Éléments fonctionnels concernés mesurés : tabs inactifs Dine-In/Delivery (13 px), « Select products to begin » (11 px), libellés du terminal (3.74:1).
- **Acceptance :** re-run du script de contraste Playwright sur POS main + PaymentTerminal + Login : zéro texte < 4.5:1 (ou < 3:1 grand texte).

### C2. `text-white` sur fond vert
- `CustomerAttachModal.tsx:227` : `bg-success text-white` → `bg-success text-green-fg` (le DS définit `--green-fg` précisément parce que « white on POS green is only ~2.5:1 »).

### C3. `text-gold-fg` systémique via le primitif
- Porter `text-gold-fg` dans la variante `primary` de `Button`/`buttonVariants` (`packages/ui`), puis sweep des ~24 fichiers POS qui composent `bg-gold … text-bg-base` à la main (échantillon : `HeldOrdersModal.tsx:133,297`, `CustomerAttachModal.tsx:182`, `BottomActionBar.tsx:211`, `POSSettingsPage.tsx:171`, `BehaviorSettingsTab.tsx:60`, `PerPayerCashStep.tsx:163`, `TenderDraftPanel.tsx:64`, `OrderTypeToggle.tsx:65`…). Rendu quasi identique (deux teintes sombres) — vérifier au screenshot avant/après.

### C4. Motion money-path + durées hors-token
- `SuccessModal.tsx:224` : retirer le `zoom-in-50 duration-500` du checkmark (animation décorative interdite sur la money-path ; au plus une apparition du conteneur en `duration-slow`).
- `PaymentTerminal.tsx:116` : `transition-all duration-300` → `transition-[width] duration-base motion-reduce:transition-none` (seule violation `prefers-reduced-motion` de la money-path).
- Durées/easings hardcodés → tokens : `CartLineRow.tsx:124` (`duration-slow ease-motion-out`), `ActiveOrderPanel.tsx:226` (`duration-base`), `SuccessModal.tsx:220` (`duration-slow`).
- `ActiveOrderPanel.tsx:226` : remplacer le `zoom-in-95 fade-in` rejoué sur chaque changement de total par un simple `fade-in` court.

### C5. Purge typo arbitraire (cf. D-b)
- Doublons de tokens : `text-[13px]` → `text-sm` (`BottomActionBar.tsx:64,322,346`, `ActiveOrderPanel.tsx:127`) ; `text-[11px]` → `text-xs` (`ActiveOrderPanel.tsx:186-215`, `CartLineRow.tsx:211,247`, `SuccessModal.tsx:242`, `payment/split/*`).
- Sous-échelle : `text-[10px]` (~18 sites : Login, CustomerDebtsPanel, ComboBadge, HeldOrdersModal, CustomerBadge, POSStockCard, ProductCard, CategorySidebar, CategoryNav, SideMenuDrawer, payment/split…) et `text-[9px]` (`TableCell.tsx:84`) → selon D-b.
- `text-4xl` (hors échelle) → `text-3xl` : `SuccessModal.tsx:248`, `PaymentTerminal.tsx:110`.
- `tracking-[0.18em]` → `tracking-ultra` (`Login.tsx:137`) ; `min-h-[44px]` → `min-h-touch-min` (`CloseShiftModal.tsx:241` ; `tracking-[0.5em]` du PIN documenté comme exception).
- `tabular-nums` sur les `formatIdr` bruts : `ComboConfigModal.tsx:169,263,311` (ou passer par `<Currency>`).

### C6. Cibles sous plancher (hors reflex-path principal)
| Fichier:ligne | Actuel | Fix |
|---|---|---|
| `BottomActionBar.tsx:69` (`MENU_ITEM`) | `h-10` (40 px) — **seul chemin** Hold/Apply discount/Redeem | `h-11` |
| `HeldOrdersModal.tsx` Restore / Delete | 116×40 / 40×40 (destructif) | `h-11`, Delete écarté ≥ 8 px |
| `HeldOrdersModal.tsx` double Close | 40×40 custom **+** 16×16 du primitif Dialog superposés | garder un seul (suivre la convention du primitif ; sinon masquer le close intégré) |
| `PaymentTerminal.tsx:88` « Back to Cart » | `size="sm"` (36 px) | retirer `size="sm"` ou supprimer (doublon du X 56 px) |
| `PinPad.tsx:131` « Annuler » | `size="sm"` (36 px) | retirer `size="sm"` |
| `POSStockCard.tsx:155,173,271` ± vitrine | `h-9` (36 px), pas d'`active:` | `h-11 w-11` + `active:scale-[0.97]` |
| `SideMenuDrawer.tsx:170` | `h-9 w-9` | `h-11 w-11` |
| `POSSettingsPage.tsx:389,398,406,484` | `p-1` (~24 px) | wrapper `h-11 w-11 grid place-items-center` |
| `Login.tsx` « Switch » / « Switch to Email Login » | 65×21 / 131×17 | `min-h-[44px]` (token `touch-min`) avec padding |

### C7. Polish (selon D-d)
- États `active:` pressed : `QuantityStepper.tsx:40,50` (packages/ui), `AttachTabCustomerButton.tsx:85-91`, `CategorySidebar.tsx:29,44`, `ActiveOrderPanel.tsx:127` — `active:scale-[0.95] active:bg-bg-overlay motion-reduce:active:scale-100`.
- Hints sur boutons désactivés portés par `title=` seul (invisible au doigt) : `BottomActionBar.tsx:265,325` → hint inline ou toast au tap.
- Supprimer les 5 composants orphelins `size="sm"` : `discounts/DiscountButton`, `discounts/LineDiscountButton`, `loyalty/RedeemButton`, `customers/CustomerAttachButton`, `heldOrders/HeldOrdersInboxButton`.
- `PrintingSettingsTab.tsx:16-46` : supprimer le `Toggle` local, importer `SettingToggle`.
- `ProductCard.tsx:115` : retirer `backdrop-blur-sm` du bouton sur image (glass réservé aux backdrops d'overlay).
- `ComboConfigModal.tsx:167,276,279,296` : vérifier/purger les classes absentes du preset (`bg-bg-subtle`, `bg-bg-card`, `bg-bg-muted`, `border-border-default`).
- OrderHistoryPanel détail (`:243-253`) : distinguer loading/erreur/pas-de-sélection · `ProductTapHandler.tsx:127-147` : toast ou ajout sans modifiers sur `modifiersQuery.isError` · `CloseShiftModal.tsx:62,79` : message si `useLoginUsers` échoue · `FloorPlanModal` : flag d'erreur au lieu de « No tables configured » (`TableSelectorButton.tsx:26-27`).

## Ordonnancement & vérification

- **Ordre :** A (layout) → B (silence) → C (sweep). A et B sont indépendantes ; C3/C5 sont des sweeps mécaniques à faire en dernier (gros diffs).
- **Vérification par vague :**
  - A : script Playwright de mesure (overflow, intersections de boxes, visibilité numpad) sur dev server, avant/après + captures.
  - B : smoke Vitest ciblés (HeldOrdersModal, ComboConfigModal, CustomerAttachModal — simuler `isError`) ; B7 = pgTAP + console POS sans 403.
  - C : re-run du script de contraste (C1) ; `pnpm typecheck && pnpm build && pnpm test` ; lint-ratchet CI (S57) doit rester vert — le sweep C5 va dans son sens.
- **Non-régression :** aucun RPC money-path modifié ; B7 est le seul objet DB (lecture pure). Les smokes existants (`CloseShiftModal` 11/11, KPI S14…) doivent rester verts.
- **Skill d'exécution :** `superpowers:subagent-driven-development` — 1 subagent par vague, la vague C parallélisable par sous-lot (C3 sweep / C5 sweep / C6 cibles).

## Hors périmètre

KDS, tablet, customer display (autres surfaces — leurs findings éventuels relèvent d'un audit dédié) ; refonte du panneau panier au-delà du fix A2 ; nouvelle couche de thème ou changement de palette (seule la **valeur** de `--text-muted` bouge, cf. D-c) ; enforcement serveur des méthodes de paiement (dette D-1 S64, sans rapport).
