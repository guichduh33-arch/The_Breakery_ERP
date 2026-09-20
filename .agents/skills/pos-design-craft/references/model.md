# pos-design-craft — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Réflexe n°1 — vérifier la réalité du repo avant de coder
- Pilier 2 — Esthétique & identité (le beau qui sert)
- Pilier 3 — Techniques 2025-2026 (chemin actuel → chemin cible)
- Pilier 4 — Patterns POS métier
- Redirections (anti-chevauchement)

Sélection : mener la création ou refonte explicitement demandée des surfaces POS, y compris tablette, KDS et customer display. Diagnostic visuel : [pos-frontend-design-audit](../../pos-frontend-design-audit/SKILL.md) ; recommandations validées : [pos-frontend-design-implement](../../pos-frontend-design-implement/SKILL.md) ; incident fonctionnel : [pos-flow-audit](../../pos-flow-audit/SKILL.md). [breakery-design](../../breakery-design/SKILL.md) et [breakery-ui-kit](../../breakery-ui-kit/SKILL.md) donnent le cadre ; la copie du dépôt d’[Impeccable](../../impeccable/SKILL.md) est un complément méthodologique.

# POS Design Craft — conception visuelle + ergonomique du POS

> **Faits re-vérifiés contre le code le 2026-08-31.** Les énoncés factuels de cette fiche
> (dépendances, noms de packages, primitifs, tokens, commandes) ont été recoupés un par un
> avec `apps/pos/package.json`, `packages/ui/src/index.ts` et la cascade
> `packages/ui/src/tokens/`. Les énoncés d'intention (direction artistique, règles
> d'ergonomie) sont inchangés. Un fait qui vieillit se re-vérifie, il ne se suppose pas.

**Posture : génératif, pas auditeur.** Ce skill conçoit et produit du neuf (écran, composant, flux, tokens, spec chiffrée) pour `apps/pos/`. Il descend au niveau code là où `breakery-design` fixe la direction artistique transversale — les deux sont compatibles : l'identité luxe-dark POS définie là-bas est le cadre, ce skill l'exécute au pixel et au tap près.

**Contexte terrain (à garder en tête à chaque décision)** : boulangerie-café artisanale à Kuta Lombok. Terrasse **plein soleil**, mains **farinées/grasses**, **rush** de service, équipe multilingue **FR/ID/EN**, deux profils : **CAISSE** (station fixe, densité max, vitesse) et **WAITER** (mobile en salle, une main, pouce).

## Réflexe n°1 — vérifier la réalité du repo avant de coder

Les libs bougent ; ne rien supposer. Avant tout livrable :

```bash
node -e "const p=require('./apps/pos/package.json');console.log(p.dependencies,p.devDependencies)"
```

État vérifié 2026-08-31 sur `apps/pos/package.json` : **React 18.2** · **Tailwind 3.4** · `sonner` ✅ · **pas** de framer-motion.

- **Fonts — la pile réelle est à trois familles** : **Playfair Display** (`@fontsource/playfair-display`, **non variable**) pour le display/marque, **Inter Variable** pour le corps, **JetBrains Mono Variable** pour les chiffres. **Fraunces est RETIRÉ du système depuis le 2026-08-01** (l'en-tête de `packages/ui/src/tokens/typography.css` porte la décision, et aucun `package.json` du dépôt ne le contient) : ne plus le citer ni le proposer.
- **Capacitor est PRÉSENT** : `@capacitor/core`, `@capacitor/android`, `@capacitor/cli`, un `apps/pos/capacitor.config.ts` et un dossier `apps/pos/android/` (APK Android v1, ADR-029, acté le 2026-08-22). C'est la **coque des tablettes de salle (profil WAITER)** ; le bundle web reste la source unique et **la CAISSE reste une web app Vite**. Aucune branche de code spécifique au natif dans les composants (ADR-029, arbitrage 2) — les capacités natives passent par des adaptateurs isolés.
- **Pas de Tauri** : aucune dépendance `@tauri-apps/*`, aucun `src-tauri/` dans le dépôt.

Le pilier 3 ci-dessous donne le chemin *actuel* ET le chemin *cible* — choisir selon package.json du jour, jamais selon ce tableau.

Même réflexe pour les **composants** : avant de spécifier un composant neuf, vérifier l'existant (`grep "export" packages/ui/src/index.ts` — ex. `QuantityStepper`, `Numpad`, `OrderTypeTabs`, `Currency`, et le primitif **`Select`** existent déjà) et le skill `breakery-ui-kit`. On améliore/étend l'existant avant de doublonner.

Croiser aussi l'**intention métier** — `docs/objectifs/POS.md` et les ADR applicables — et l'état de l'art des POS de référence (Square, Toast, Storyous, Lightspeed) via WebSearch si la décision est structurante.

---

## Pilier 2 — Esthétique & identité (le beau qui sert)

- **Tokens OKLCH** : toute couleur neuve se définit en OKLCH (perceptuellement uniforme → dérivation propre des états hover/pressed/disabled en ajustant L, et des variantes dark en miroir). Snippet prêt à adapter : [`references/tokens-oklch.md`](tokens-oklch.md) — deux formes : custom props (Tailwind v3 actuel, s'insère dans la cascade `@breakery/ui/tokens.css`) et `@theme` (v4 cible). Jamais de hex neuf en dur dans un composant.
- **Densité maîtrisée** : dense mais respirant — grille produits serrée (le scan visuel prime), ticket aéré (la vérification prime). Hiérarchie par taille/graisse/surface, pas par accumulation de couleurs. Profil CAISSE = densité max ; WAITER = cibles plus grosses, moins d'items visibles.
- **Chiffres tabulaires obligatoires** : `font-variant-numeric: tabular-nums` (ou classe utilitaire dédiée) sur **tous** les prix, totaux, quantités, timers — un total qui « danse » quand les chiffres changent est disqualifiant sur un POS. Config dans le snippet référence.
- **Échelle typo lisible à distance de bras** (~50-70 cm) : total encaissement = le plus gros élément de l'écran ; corps opérationnel ≥ 16 px ; s'appuyer sur `typography.css` de `@breakery/ui`, ne pas inventer de tailles.
- **Micro-interactions utiles, jamais ralentissantes** : ajout panier (l'item « part » vers le ticket ou badge compteur pulse, ≤ 200 ms), encaissement réussi (confirmation franche), transitions d'état via tokens `motion.css`. framer-motion/Motion **seulement si présent dans package.json** ; sinon transitions CSS. Respecter `prefers-reduced-motion`. Aucune animation décorative sur la money-path (règle AGENTS.md).
- **Marque The Breakery** : chaleur artisanale — **Playfair Display** (`--font-display`) pour les moments de marque (accueil, customer display), et lui seul : c'est le seul serif de la pile canonique depuis le retrait de Fraunces le 2026-08-01. Pas un POS générique froid ; pas un jouet non plus.
- **Palette : héritage ≠ carcan.** Le gold/charcoal luxe-dark est l'identité *actuelle*, pas une limite : ce skill **propose activement** des directions de palette neuves en OKLCH (terracotta/crème boulangerie, sauge/miel, contraste solaire haute-luminance pour la terrasse, accents saisonniers…) — toujours en **2-3 variantes nommées** avec aperçu rendu (voir le [protocole de vérification visuelle](verification.md)), jamais imposées : l'utilisateur tranche, puis la gagnante entre dans la cascade tokens proprement. Une proposition de palette n'est recevable qu'avec ses ratios de contraste calculés.

## Pilier 3 — Techniques 2025-2026 (chemin actuel → chemin cible)

| Sujet | Aujourd'hui (React 18 / TW v3 — vérifié) | Cible (si package.json a bougé) |
|-------|------------------------------------------|--------------------------------|
| Ajout panier instantané | Optimistic update TanStack Query (`onMutate` + rollback `onError`) ou state Zustand local avant confirmation serveur | React 19 `useOptimistic` |
| Mutations | Hooks `useMutation` existants (pattern projet) | React 19 Actions / `useActionState` |
| Refs | `forwardRef` classique | React 19 : ref en prop, primitives `data-slot` |
| Tokens | Custom props CSS dans la cascade `@breakery/ui/tokens.css` (valeurs OKLCH OK dès maintenant) | Tailwind v4 `@theme` + `size-*` |
| Toasts | `sonner` (déjà en place — ne pas réintroduire un autre toast) | idem |
| Transitions d'écran | `document.startViewTransition` **guardé** (`if (!document.startViewTransition) fallback`) — progressive enhancement grille↔ticket↔paiement | View Transitions API pleinement |
| Offline / réseau dégradé | **Livré** — file d'attente locale + rejeu, tous moyens de paiement sauf l'avoir (ADR-015). **Designer les états** : indicateur de sync visible, boutons désactivés avec raison, jamais d'UI muette sur `fetch` échoué | États `pending`/`synced`/`failed` visibles **par ligne** de file |

Règle : proposer le pattern cible en commentaire/note quand pertinent, implémenter le pattern actuel. Une PR de design ne migre pas React ni Tailwind en passant.

## Pilier 4 — Patterns POS métier

- **Grille produits** : catégories en onglets bord d'écran (cibles infinies), favoris/meilleures ventes en tête, recherche = raccourci pas chemin principal. Image produit : oui si elle accélère le scan, non si elle ralentit le rendu.
- **Ticket/panier** : chaque ligne = nom + quantité + prix tabulaire + accès modificateurs ; correction quantité inline (cibles ± aux tailles rush du Pilier 1) sans quitter l'écran ; grandes quantités : tap sur la valeur → `Numpad` (existant), pas 11 taps pour 12 croissants ; total toujours visible, jamais scrollé hors champ.
- **Modificateurs** : prompts forcés à l'ajout quand la donnée l'exige (cuisson, taille) — la modale de modifier est la SEULE modale tolérée dans le flux d'ajout, et elle se ferme en un tap.
- **Order types** dine-in / takeaway / delivery : sélection persistante visible (`OrderTypeTabs` existe dans `@breakery/ui`), jamais enterrée dans un menu.
- **Dual-screen** : l'écran opérateur optimise la vitesse ; le **customer display** (fenêtre séparée, broadcast `payment_complete` existant) optimise la confiance — récap lisible à 1-2 m, total énorme, moment merci/monnaie piloté par `PAYMENT_COMPLETE_DISPLAY_MS` dans `useCartBroadcast.ts`, fidélité/promo si calme, jamais d'anxiogène pendant le paiement.
- **KDS** : la couleur = code d'attente (défaut proposé : vert < 5 min, ambre 5-10, rouge > 10 — chercher d'abord des seuils métier réels dans `business_config`/le code KDS existant ; s'ils n'existent pas, proposer ces défauts ET les rendre configurables), minuterie par ticket, bump 1 tap cible énorme, tri par priorité/station. Zéro décoratif.
- **CAISSE vs WAITER** : même système de tokens, densités différentes — CAISSE : plus d'items/écran, raccourcis clavier possibles ; WAITER : cibles ≥ 56 px partout, actions au pouce, parcours table→commande→envoi raccourci.

---

## Redirections (anti-chevauchement)

| Demande | → Aller vers |
|---------|--------------|
| Audit rétrospectif d'un écran POS existant (détection d'écarts, findings) | `pos-frontend-design-audit` — il existe (vérifié 2026-08-31) et rend un rapport en conversation ; pour CODER une reco de ce rapport → `pos-frontend-design-implement`. La checklist d'audit transverse reste chez `breakery-design` |
| UI/UX **hors POS** (Backoffice, composant partagé générique) | `breakery-design` (direction par surface) + `breakery-ui-kit` (primitives/tokens) |
| Quel primitif/export existe dans `@breakery/ui` — `Select` **existe** (un `<select>` natif stylé) ; `RadioGroup`, `Checkbox`, `Popover`, `Tooltip` n'existent toujours pas et demandent un fallback natif (vérifié 2026-08-31) | `breakery-ui-kit` |
| Bug isolé (comportement cassé, pas de conception) | fix direct, pas ce skill |
| Migration DB, RPC, comptabilité | `db-engineer` / skill `accounting` |

Si la tâche reçue est un audit ou du non-POS : le dire explicitement et rediriger, ne pas produire quand même.
