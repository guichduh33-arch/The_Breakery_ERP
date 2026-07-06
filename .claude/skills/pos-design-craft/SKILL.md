---
name: pos-design-craft
description: 'Spécialiste GÉNÉRATIF de la conception visuelle + ergonomique du POS The Breakery (apps/pos) — conçoit et produit écrans, composants, flux, tokens neufs en appliquant l''état de l''art 2025-2026 (Fitts, cibles rush 56-72px, OKLCH, tabular-nums, optimistic UI, View Transitions). Use when : design POS, refonte caisse, nouvel écran POS, maquette/composant caisse, écran de vente, grille produits, ticket/panier, customer display, KDS design, ergonomie POS, plein soleil, rush, thumb zone, design tokens POS, micro-interactions caisse, profils CAISSE/WAITER. NE PAS utiliser pour : audit rétrospectif (→ breakery-design checklist), bug isolé, UI non-POS (→ breakery-ui-kit/breakery-design), migration DB, comptabilité.'
pathPatterns:
  - 'apps/pos/src/**'
promptSignals:
  phrases:
    - 'design POS'
    - 'refonte caisse'
    - 'nouvel écran POS'
    - 'nouveau écran POS'
    - 'maquette POS'
    - 'composant caisse'
    - 'écran de vente'
    - 'grille produits'
    - 'ticket POS'
    - 'panier POS'
    - 'customer display'
    - 'KDS design'
    - 'design KDS'
    - 'ergonomie POS'
    - 'ergonomie caisse'
    - 'plein soleil'
    - 'rush'
    - 'thumb zone'
    - 'design tokens POS'
    - 'micro-interactions caisse'
    - 'profil WAITER'
    - 'écran d''encaissement'
---

# POS Design Craft — conception visuelle + ergonomique du POS

**Posture : génératif, pas auditeur.** Ce skill conçoit et produit du neuf (écran, composant, flux, tokens, spec chiffrée) pour `apps/pos/`. Il descend au niveau code là où `breakery-design` fixe la direction artistique transversale — les deux sont compatibles : l'identité luxe-dark POS définie là-bas est le cadre, ce skill l'exécute au pixel et au tap près.

**Contexte terrain (à garder en tête à chaque décision)** : boulangerie-café artisanale à Kuta Lombok. Terrasse **plein soleil**, mains **farinées/grasses**, **rush** de service, équipe multilingue **FR/ID/EN**, deux profils : **CAISSE** (station fixe, densité max, vitesse) et **WAITER** (mobile en salle, une main, pouce).

## Réflexe n°1 — vérifier la réalité du repo avant de coder

Les libs bougent ; ne rien supposer. Avant tout livrable :

```bash
node -e "const p=require('./apps/pos/package.json');console.log(p.dependencies,p.devDependencies)"
```

État vérifié 2026-07-06 : **React 18.2** · **Tailwind 3.4** · `sonner` ✅ · fonts variables Fraunces/Inter/JetBrains Mono ✅ · **pas** de framer-motion, **pas** de Capacitor/Tauri (POS = web app Vite). Le pilier 3 ci-dessous donne le chemin *actuel* ET le chemin *cible* — choisir selon package.json du jour, jamais selon ce tableau.

Même réflexe pour les **composants** : avant de spécifier un composant neuf, vérifier l'existant (`grep "export" packages/ui/src/index.ts` — ex. `QuantityStepper`, `Numpad`, `OrderTypeTabs` existent déjà) et le skill `breakery-ui-kit`. On améliore/étend l'existant avant de doublonner.

Croiser aussi, **s'ils existent** (vérifier par Glob, ne pas supposer) : `docs/objectif travail/POS.md`, `docs/Design/caissapp/`, et l'état de l'art des POS de référence (Square, Toast, Storyous, Lightspeed) via WebSearch si la décision est structurante.

---

## Pilier 1 — Pratique & vitesse (ergonomie terrain)

Chaque règle est chiffrée ; toute déviation se justifie par écrit.

- **Loi de Fitts** : temps d'atteinte ∝ distance/taille. Donc : cibles fréquentes = **grandes + proches de la zone d'attention** ; actions d'angle/bord = cibles « infinies » (le doigt bute sur le bord, impossible de dépasser) — y placer Encaisser, catégorie active. **Minimiser la distance panier↔grille** : le ratio ajout-produit/correction est ~20:1, le layout doit refléter ce ratio.
- **Cibles tactiles** : plancher absolu 44 px (WCAG), confort Android 48 px ; **actions de rush (ajout produit, Encaisser, ± quantité) : 56–72 px** — arbitrage dans la fourchette : 56 px en densité CAISSE, **64 px par défaut en WAITER** (pouce), 72 px pour l'action Encaisser. **Espacement : plancher 8 px, 12 px en rush/WAITER.** Raison : mains grasses/farinées = précision dégradée, le coût d'un mis-tap en rush est disproportionné.
- **Thumb zones (profil WAITER, une main)** : actions primaires dans le tiers bas / bord dominant ; actions destructrices (void, suppression ligne) **hors zone de réflexe** — jamais adjacentes à une action fréquente.
- **Compter les taps** : mesurer le chemin produit→encaissement en taps ; chaque écran conçu doit annoncer son compte. Défauts intelligents (variante la plus vendue pré-sélectionnée, quantité 1) + modificateurs rapides > arborescences profondes.
- **Feedback < 100 ms perçu** sur chaque tap : visuel (état pressed net) toujours ; haptique si la plateforme le permet (`navigator.vibrate(10)` guardé — Capacitor Haptics seulement si la coque native existe dans le repo) ; sonore optionnel et coupable. Jamais de latence perçue : optimistic UI (pilier 3).
- **Tolérance à l'erreur** : undo non-bloquant (toast sonner avec action Annuler, 5 s) > confirmation préalable. Modale de confirmation **uniquement** pour l'irréversible (void, abandon de commande) — jamais de modale qui casse le flux d'ajout en rush.
- **Plein soleil** : sur les chiffres (prix, totaux, quantités) viser **AAA (7:1)** ; minimum AA partout. Interdits : gris pâle sur fond clair, texte < 16 px pour l'opérationnel, information portée par la couleur seule.

## Pilier 2 — Esthétique & identité (le beau qui sert)

- **Tokens OKLCH** : toute couleur neuve se définit en OKLCH (perceptuellement uniforme → dérivation propre des états hover/pressed/disabled en ajustant L, et des variantes dark en miroir). Snippet prêt à adapter : [`references/tokens-oklch.md`](references/tokens-oklch.md) — deux formes : custom props (Tailwind v3 actuel, s'insère dans la cascade `@breakery/ui/tokens.css`) et `@theme` (v4 cible). Jamais de hex neuf en dur dans un composant.
- **Densité maîtrisée** : dense mais respirant — grille produits serrée (le scan visuel prime), ticket aéré (la vérification prime). Hiérarchie par taille/graisse/surface, pas par accumulation de couleurs. Profil CAISSE = densité max ; WAITER = cibles plus grosses, moins d'items visibles.
- **Chiffres tabulaires obligatoires** : `font-variant-numeric: tabular-nums` (ou classe utilitaire dédiée) sur **tous** les prix, totaux, quantités, timers — un total qui « danse » quand les chiffres changent est disqualifiant sur un POS. Config dans le snippet référence.
- **Échelle typo lisible à distance de bras** (~50-70 cm) : total encaissement = le plus gros élément de l'écran ; corps opérationnel ≥ 16 px ; s'appuyer sur `typography.css` de `@breakery/ui`, ne pas inventer de tailles.
- **Micro-interactions utiles, jamais ralentissantes** : ajout panier (l'item « part » vers le ticket ou badge compteur pulse, ≤ 200 ms), encaissement réussi (confirmation franche), transitions d'état via tokens `motion.css`. framer-motion/Motion **seulement si présent dans package.json** ; sinon transitions CSS. Respecter `prefers-reduced-motion`. Aucune animation décorative sur la money-path (règle CLAUDE.md).
- **Marque The Breakery** : chaleur artisanale — Fraunces/Playfair pour les moments de marque (accueil, customer display). Pas un POS générique froid ; pas un jouet non plus.
- **Palette : héritage ≠ carcan.** Le gold/charcoal luxe-dark est l'identité *actuelle*, pas une limite : ce skill **propose activement** des directions de palette neuves en OKLCH (terracotta/crème boulangerie, sauge/miel, contraste solaire haute-luminance pour la terrasse, accents saisonniers…) — toujours en **2-3 variantes nommées** avec aperçu rendu (voir protocole Playwright ci-dessous), jamais imposées : l'utilisateur tranche, puis la gagnante entre dans la cascade tokens proprement. Une proposition de palette n'est recevable qu'avec ses ratios de contraste calculés.

## Pilier 3 — Techniques 2025-2026 (chemin actuel → chemin cible)

| Sujet | Aujourd'hui (React 18 / TW v3 — vérifié) | Cible (si package.json a bougé) |
|-------|------------------------------------------|--------------------------------|
| Ajout panier instantané | Optimistic update TanStack Query (`onMutate` + rollback `onError`) ou state Zustand local avant confirmation serveur | React 19 `useOptimistic` |
| Mutations | Hooks `useMutation` existants (pattern projet) | React 19 Actions / `useActionState` |
| Refs | `forwardRef` classique | React 19 : ref en prop, primitives `data-slot` |
| Tokens | Custom props CSS dans la cascade `@breakery/ui/tokens.css` (valeurs OKLCH OK dès maintenant) | Tailwind v4 `@theme` + `size-*` |
| Toasts | `sonner` (déjà en place — ne pas réintroduire un autre toast) | idem |
| Transitions d'écran | `document.startViewTransition` **guardé** (`if (!document.startViewTransition) fallback`) — progressive enhancement grille↔ticket↔paiement | View Transitions API pleinement |
| Offline / réseau dégradé | Le mode hors-ligne est un chantier Vague 3 du workplan — en attendant, **designer les états** : indicateur de sync visible, boutons désactivés avec raison, jamais d'UI muette sur `fetch` échoué | Offline-first (queue locale + sync) : états pending/synced/failed visibles par ligne |

Règle : proposer le pattern cible en commentaire/note quand pertinent, implémenter le pattern actuel. Une PR de design ne migre pas React ni Tailwind en passant.

## Pilier 4 — Patterns POS métier

- **Grille produits** : catégories en onglets bord d'écran (cibles infinies), favoris/meilleures ventes en tête, recherche = raccourci pas chemin principal. Image produit : oui si elle accélère le scan, non si elle ralentit le rendu.
- **Ticket/panier** : chaque ligne = nom + quantité + prix tabulaire + accès modificateurs ; correction quantité inline (cibles ± aux tailles rush du Pilier 1) sans quitter l'écran ; grandes quantités : tap sur la valeur → `Numpad` (existant), pas 11 taps pour 12 croissants ; total toujours visible, jamais scrollé hors champ.
- **Modificateurs** : prompts forcés à l'ajout quand la donnée l'exige (cuisson, taille) — la modale de modifier est la SEULE modale tolérée dans le flux d'ajout, et elle se ferme en un tap.
- **Order types** dine-in / takeaway / delivery : sélection persistante visible (`OrderTypeTabs` existe dans `@breakery/ui`), jamais enterrée dans un menu.
- **Dual-screen** : l'écran opérateur optimise la vitesse ; le **customer display** (fenêtre séparée, broadcast `payment_complete` existant) optimise la confiance — récap lisible à 1-2 m, total énorme, moment merci/monnaie 8 s, fidélité/promo si calme, jamais d'anxiogène pendant le paiement.
- **KDS** : la couleur = code d'attente (défaut proposé : vert < 5 min, ambre 5-10, rouge > 10 — chercher d'abord des seuils métier réels dans `business_config`/le code KDS existant ; s'ils n'existent pas, proposer ces défauts ET les rendre configurables), minuterie par ticket, bump 1 tap cible énorme, tri par priorité/station. Zéro décoratif.
- **CAISSE vs WAITER** : même système de tokens, densités différentes — CAISSE : plus d'items/écran, raccourcis clavier possibles ; WAITER : cibles ≥ 56 px partout, actions au pouce, parcours table→commande→envoi raccourci.

---

## Vérification visuelle & recherche en ligne (MCP Playwright)

Ce skill ne livre pas à l'aveugle : il **se vérifie dans un vrai navigateur** via les outils MCP Playwright (`mcp__plugin_playwright_playwright__browser_*` — charger via ToolSearch en un seul appel).

**Protocole d'auto-vérification d'un design :**
1. **Rendre** : soit le dev server du POS (`pnpm --filter @breakery/pos dev` puis `browser_navigate`), soit un mockup HTML self-contained écrit dans un fichier temporaire (`browser_navigate` vers `file:///...`) pour les variantes de palette/layout.
2. **Mesurer, pas estimer** : `browser_evaluate` avec `getBoundingClientRect()` sur les cibles tactiles (vérifier ≥ 56/64 px réels, espacements), `getComputedStyle` pour les tailles de police et couleurs résolues ; calcul du ratio de contraste WCAG directement en JS dans la page (luminance relative depuis les rgb computed) — c'est la méthode de référence, plus fiable que la conversion manuelle OKLCH.
3. **Capturer** : `browser_take_screenshot` de chaque variante — aux dimensions réelles des devices cibles (`browser_resize` : tablette caisse ~1280×800, mobile waiter ~390×844) et joindre les captures au rapport.
4. **Itérer** : un critère chiffré non atteint (cible trop petite, contraste < 7:1) se corrige et se re-mesure avant livraison — jamais « ça devrait aller ».

**Recherche en ligne (état de l'art & compétences fraîches) :** quand la décision est structurante ou que le savoir embarqué date : WebSearch pour les patterns/trends récents, et **navigation Playwright** pour inspecter en direct les références publiques (démos/docs de Square, Toast, Lightspeed, galeries type Mobbin/Dribbble) — en extraire des *principes mesurés* (tailles, densités, hiérarchies), jamais du code copié ni des assets protégés.

---

## Checklist de conception (definition of done d'un livrable)

| ✓ | Critère |
|---|---------|
| ☐ | Versions package.json vérifiées, patterns du bon chemin (actuel vs cible) |
| ☐ | Cibles : rush 56-72 px, plancher 44/48 px, espacement ≥ 8 px — mesures annoncées |
| ☐ | Compte de taps du flux annoncé (et comparé à l'existant si refonte) |
| ☐ | Contraste : AAA sur chiffres, AA partout — **mesuré dans le navigateur** (protocole Playwright), pas estimé |
| ☐ | Cibles/espacements **mesurés** au `getBoundingClientRect` sur le rendu réel + screenshots des variantes joints |
| ☐ | Feedback < 100 ms sur chaque interaction (pressed + optimistic + toast undo) |
| ☐ | Chiffres en tabular-nums ; total = élément dominant |
| ☐ | Tokens : zéro hex en dur, OKLCH pour le neuf, cascade `@breakery/ui` respectée |
| ☐ | États réseau dégradé designés (pending/failed visibles, pas d'UI muette) |
| ☐ | Destructif hors zone de réflexe + confirmation seulement si irréversible |
| ☐ | `prefers-reduced-motion` respecté ; aucune animation décorative money-path |
| ☐ | Profil précisé (CAISSE/WAITER/les deux) et densité adaptée |
| ☐ | Chaque choix justifié par un principe (Fitts, contraste, densité, tolérance erreur) |

**Format de sortie** : rapport en français ; livrable = code `.tsx`/tokens CSS **ou** spec de design chiffrée selon la demande ; profondeur adaptée au scope (un token isolé ne déclenche pas une refonte).

---

## Redirections (anti-chevauchement)

| Demande | → Aller vers |
|---------|--------------|
| Audit rétrospectif d'un écran POS existant (détection d'écarts, findings) | `breakery-design` (checklist audit 11 points) — ou un skill `pos-*-audit` dédié si `ls .claude/skills` en montre un |
| UI/UX **hors POS** (Backoffice, composant partagé générique) | `breakery-design` (direction par surface) + `breakery-ui-kit` (primitives/tokens) |
| Quel primitif/export existe dans `@breakery/ui`, fallbacks Select/RadioGroup | `breakery-ui-kit` |
| Bug isolé (comportement cassé, pas de conception) | fix direct, pas ce skill |
| Migration DB, RPC, comptabilité | `db-engineer` / skill `accounting` |

Si la tâche reçue est un audit ou du non-POS : le dire explicitement et rediriger, ne pas produire quand même.
