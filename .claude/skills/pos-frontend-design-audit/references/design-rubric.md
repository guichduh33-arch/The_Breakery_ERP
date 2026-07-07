# Grille de critères design POS + seuils concrets

Utilise cette grille en Étape 3. Chaque critère est mesurable dans le code. Attribue un **score de maturité 1-5 par écran**, puis classe chaque manquement en sévérité (P0-P3).

## Échelle de maturité (par écran)

| Score | Niveau | Signification |
|---|---|---|
| 1 | Absent | Fonction présente mais design non pensé : tailles au hasard, états manquants, illisible en condition réelle. |
| 2 | Fragile | Marche au calme, casse en rush / sur tablette debout / hors-ligne. États partiels. |
| 3 | Fonctionnel | Correct, cohérent avec les tokens, mais sans optimisation pour la vitesse ou la lisibilité à distance. |
| 4 | Soigné | Hiérarchie claire, cibles tactiles confortables, états complets, pensé pour le profil. |
| 5 | Référence | Au niveau des leaders du marché : gestes rapides, zéro friction sur le chemin fréquent. |

## 1. Cibles tactiles (touch targets)

Référence : Apple HIG **44×44 pt**, Material **48×48 dp**.

**⚠️ Résous d'abord les tokens tactiles du design-system — ne juge pas en `h-N` brut.** Le projet définit des tokens sémantiques (`packages/ui/src/tokens/luxe-dark.css`) que le `Button` `@breakery/ui` consomme via ses variantes `size`. Un bouton `<Button size="lg">` fait **80px**, pas `h-11` — confondre les deux fait sous-évaluer la maturité tactile.

| Token / variante | Hauteur | Verdict |
|---|---|---|
| `h-touch-large` · `<Button size="lg">` | **80px** | ✅ généreux (CTA primaire, numpad, tuiles méthode) |
| `h-14` | 56px | ✅ confortable |
| `h-touch-comfy` · `<Button size="md">` (défaut) · `size="icon"` | **56px** | ✅ confortable (défaut Button = déjà au-dessus du seuil) |
| `h-12` | 48px | ✅ bon (cible recommandée action primaire tablette) |
| `h-touch-min` · `<Input>` | **44px** | 🟡 minimum (saisies, OK densité caisse), **limite** doigt en mouvement |
| `h-11` | 44px | 🟡 minimum acceptable, **limite** pour le doigt en mouvement |
| `h-10` | 40px | 🔴 **sous le seuil** pour une action primaire/fréquente — P0/P1 selon fréquence |
| `h-9` · `<Button size="sm">` et moins | ≤36px | 🔴 réservé à des contrôles secondaires non critiques uniquement |

Avant de juger une taille : si c'est un `<Button>` regarde sa prop `size` (défaut = `md` = 56px) ; si c'est une classe `h-touch-*` résous-la via le tableau ci-dessus ; seul un `h-N` Tailwind littéral se lit directement en pixels (×4).

- **CAISSE** (desktop, doigt posé, écran proche) : tolère `h-11` sur les actions denses, mais **paiement / encaissement / quantité** méritent `h-12`+.
- **WAITER** (tablette, debout, en mouvement, écran tenu à bout de bras) : vise **`h-12` minimum** sur toute action de prise de commande. Espacement entre cibles ≥ 8px (`gap-2`) pour éviter les taps voisins.
- Vérifie aussi la **zone cliquable réelle** (un `<button>` avec padding) vs l'icône seule (`h-4 w-4` cliquable = 16px = 🔴).

## 2. Vitesse d'exécution (budget de taps)

Compte les interactions du grid jusqu'à l'action terminale, pour les 3 produits les plus vendus.

| Parcours | Budget cible | Drapeau rouge |
|---|---|---|
| Café sans modificateur → encaissé cash (caisse) | ≤ 4 taps (produit → checkout → cash → montant exact) | > 6 taps |
| Produit avec modificateur requis | +1 écran modale max, options en 1 tap chacune | modale à scroller pour une option courante |
| Waiter : produit → envoyé en cuisine | ≤ 3 taps après table choisie | re-choisir la table à chaque produit |

Repère : profondeur de navigation (modales empilées), allers-retours (backtrack), saisies clavier physique imposées (le POS est **touch-first** : un numpad virtuel doit gérer toute saisie). Un favori/most-sold non surfacé visuellement = taps perdus.

## 3. Hiérarchie visuelle & lisibilité

- **Hiérarchie** : l'action primaire de l'écran est-elle la plus saillante (taille, couleur gold, position) ? Le prix total et le CTA de paiement dominent-ils le panier ?
- **Lisibilité à distance** (customer display, KDS lus de loin ; caisse en rush, coup d'œil) : taille de police suffisante, contraste fort. Le KDS et le customer display doivent être lisibles à 1-2 m.
- **Contraste** : WCAG AA = **4.5:1** texte normal, **3:1** texte large (≥24px ou ≥19px gras). Méfie-toi de `text-text-muted`/`text-text-tertiary` sur surfaces sombres pour une info importante (prix, total, statut) → souvent sous le seuil. L'info critique ne doit jamais être en muted.
- **Densité** : grille produits trop aérée = scroll en rush (mauvais) ; trop dense = taps voisins. Juge `grid-cols-N` vs taille d'écran réelle du profil.

## 4. Couverture des états

Tout surface asynchrone doit gérer : **loading (skeleton)**, **empty**, **erreur**, et pour la tablette **offline**. Optimistic UI bienvenu sur les ajouts panier.

- Loading : skeleton structurel (pas un spinner nu) sur les grilles/listes.
- Empty : `EmptyState` brandé avec action, pas un vide muet.
- Erreur : `ErrorState` avec retry, pas un `toast` qui disparaît pour une erreur bloquante.
- Offline (WAITER seulement) : `OfflineBanner` visible + actions réseau désactivées avec feedback clair.
- États lockés/disabled : visuellement distincts (opacity + raison), pas juste inertes.

## 5. Cohérence design-system

- **Tokens, jamais de couleur en dur** : `text-text-primary`, `bg-bg-elevated`, `text-gold`, `var(--success/warning/danger)`… Tout `#hex` ou `bg-white` hors token = constat.
- **Typo canonique** : `font-display` (Playfair, titres) · `font-sans` (Inter, corps) · `font-mono` (JetBrains, prix/montants/timestamps). Un prix qui n'est pas en mono = incohérence.
- **Primitifs `@breakery/ui`** : un composant qui ré-implémente un Dialog/Badge/Card local au lieu du primitif partagé = dette. Cf. `breakery-ui-kit` pour ce qui existe (et les fallbacks natifs pour `Select`/`RadioGroup`/`Checkbox` qui n'existent PAS).
- **Focus visibles** : `focus-visible:outline-gold` cohérent (a11y clavier + lecteurs de la conformité).

## 6. Responsive : CAISSE vs WAITER

- **CAISSE** : desktop large, paysage, 3 colonnes. Optimise la **densité** et le coup d'œil. Risque : layout qui suppose une largeur fixe et casse sur un écran caisse plus petit.
- **WAITER** : tablette/mobile, souvent **portrait**, tenue à une main, debout. Optimise les **grandes cibles**, le pouce-atteignable (actions primaires en bas), et le **mode offline**. Risque : réutiliser tel quel un layout desktop (grille 4 colonnes trop dense, cart 300px qui mange l'écran).
- Un même composant partagé (ex. `ProductGrid` réutilisé en tablette) doit être jugé **séparément pour chaque profil**.

## 7. Ergonomie de rush (spécifique boulangerie-café, 200 cmd/jour)

- **Favoris / most-sold** surfacés en tête de grille (épinglés) ?
- **Recherche** rapide et tolérante (un caissier tape 2 lettres) ?
- **Quantités rapides** : stepper visible, ou appui long / multi-tap pour +1 ?
- **Quick-cash** au paiement (exact, 50k, 100k) pour éviter le numpad ?
- **Geste de répétition** (re-commander le dernier item, dupliquer une ligne) ?
- **Mode dégradé** : écran gras, doigts, gants, lecture rapide — les contrastes et tailles tiennent-ils ?

## Mapping critère → sévérité

- **P0** : touche le chemin le plus fréquent plusieurs fois/jour (cible tactile d'un bouton de paiement, taps en trop sur l'encaissement, prix illisible).
- **P1** : friction fréquente mais pas à chaque commande (état manquant, favoris non surfacés, layout tablette dense).
- **P2** : polish (incohérence de token sur un écran secondaire, micro-interaction).
- **P3** : stratégique/futur (nouveau pattern de geste, refonte d'un écran rarement utilisé).
