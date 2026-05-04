# 04 — Keyboard shortcuts

> **Last verified**: 2026-05-03

Liste des raccourcis clavier utilisables dans AppGrav V2.

> **Note importante** : V2 n'utilise **pas** de bibliothèque dédiée (`react-hotkeys-hook` ou `mousetrap`). Les raccourcis sont implémentés ad-hoc via `onKeyDown` sur les composants ciblés ou via le composant **`cmdk`** (palette de commandes). La couverture est volontairement minimale — l'accent est mis sur le tactile (POS tactile + tablette).

---

## 1. Globaux

| Raccourci | Action | Implémentation |
|---|---|---|
| `Cmd / Ctrl + K` | Ouvre la palette de commandes (Command Palette) | `src/components/ui/CommandPalette.tsx` (lib `cmdk`) |
| `Esc` | Ferme la modal / palette / dropdown ouvert | Géré nativement par les primitives Radix (shadcn `Dialog`, `Popover`, `Command`) |
| `Tab` / `Shift+Tab` | Navigation focus standard | Browser natif + ordre DOM préservé |

---

## 2. Command Palette (`cmdk`)

Quand `Cmd/Ctrl+K` est pressé, la palette s'ouvre. À l'intérieur :

| Raccourci | Action |
|---|---|
| `↑` / `↓` | Naviguer dans la liste de commandes |
| `Enter` | Exécuter l'item sélectionné |
| `Esc` | Fermer la palette |
| Saisie texte | Recherche fuzzy parmi les commandes (filtre client par défaut — cf. pitfall #15 sur `shouldFilter={false}` quand source serveur) |

**Catégories de commandes** disponibles (cf. `CommandPalette.tsx` `Command.Group heading="Navigation"`) :

- Navigation entre pages
- Actions rapides (créer order, ouvrir KDS, etc.)

> Le pattern `shouldFilter={false}` est utilisé dans `<GlobalSearchCmdK>` pour les recherches Supabase server-side. Voir [`11-conventions/06-pitfalls.md`](../11-conventions/06-pitfalls.md) §15.

---

## 3. Forms — confirmer / annuler

| Raccourci | Contexte | Action |
|---|---|---|
| `Enter` | Input texte simple (PIN, search, qty) | Submit form / valider valeur |
| `Esc` | Modal ouverte | Fermer modal + reset form |
| `Tab` | Inputs successifs | Focus next |

**Exemples observés dans le code** :

| Fichier | Comportement |
|---|---|
| `src/components/customers/CustomerCategoryForm.tsx:51` | `Enter` ou `Space` sur card catégorie → sélectionne |
| `src/components/settings/ArrayAmountEditor.tsx:97` | `Enter` dans input → ajoute valeur |
| `src/components/settings/SettingField.tsx:76` | `Enter` sur boolean → toggle |
| `src/components/pos/POSTerminalWrapper.tsx:456` | `Enter` ou `Space` sur product card → sélection |
| `src/components/pos/cafe-stock/CafeStockProductCard.tsx:69` | `Enter` sur input qty → save |

---

## 4. POS — paiement

| Raccourci | Action | Statut |
|---|---|---|
| `Enter` | Confirmer paiement (modal Payment) | Implémenté via `<button type="submit">` natif sur form modal |
| `Esc` | Annuler paiement en cours | Géré par shadcn Dialog |

> **À noter** : la majorité du POS est conçu pour un usage **tactile**. Aucun raccourci numérique de catégorie/produit n'est implémenté en V2. Les caissiers utilisent les boutons à l'écran et le pavé numérique virtuel (`VirtualKeypadProvider`).

---

## 5. KDS (Kitchen Display System)

| Raccourci | Action | Statut |
|---|---|---|
| `Enter` / `Space` | Marquer item ready (sur card focusée via Tab) | Implémenté via `onKeyDown` sur cards |
| `Esc` | Désélectionner | Browser natif |

**Pas de shortcuts globaux** type "F1 = next order". Le KDS est conçu pour fonctionner sur un écran tactile dédié (interaction au doigt sur les cards).

---

## 6. Reports & BackOffice

| Raccourci | Action |
|---|---|
| `Cmd/Ctrl + K` | Palette pour naviguer rapidement vers un report |
| Filtres date | Pas de raccourcis spécifiques — interaction souris/touch |
| Export PDF/Excel | Pas de raccourci — bouton dédié |

---

## 7. Accessibilité — règles transverses

Tous les composants interactifs respectent (ou doivent respecter) :

- `tabIndex={0}` sur éléments custom interactifs
- `onKeyDown` qui mappe `Enter` ET `Space` à l'action principale (cf. `POSTerminalWrapper.tsx:456`)
- `aria-label` ou `aria-pressed` selon le rôle
- `role="button"` quand l'élément n'est pas un `<button>` natif

```tsx
// Pattern canonique (POSTerminalWrapper.tsx)
<div
  role="button"
  tabIndex={0}
  onClick={() => onProductSelect(product)}
  onKeyDown={(e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isSoldOut) {
      e.preventDefault()
      onProductSelect(product)
    }
  }}
>
  ...
</div>
```

---

## 8. Lacunes connues

| Lacune | Statut |
|---|---|
| Pas de raccourci "shift+? = aide" | Item potentiel backlog UX |
| Pas de mappage `F1`-`F12` pour catégories POS | Conscient — POS tactile, non prioritaire |
| Pas de `Cmd+S` pour save formulaires | Tous les forms ont un bouton Save explicite |
| Pas de raccourci global "/print last receipt" | Bouton dédié dans header POS |

> Ces lacunes sont documentées dans l'audit UX/UI (`docs/audit/05-uiux-design-audit.md`). Aucune n'est critique vu l'usage tactile dominant.

---

## 9. Étendre la couverture (recommandation V3)

Si V3 décide d'étendre les raccourcis :

1. Adopter `react-hotkeys-hook` pour la centralisation
2. Documenter le mapping dans une UI dédiée (modal "Keyboard shortcuts")
3. Surfacer dans `cmdk` les commandes principales avec leur shortcut affiché à droite
4. Tester avec lecteur d'écran (NVDA, VoiceOver)

Pour V2 : conservation du minimum actuel — pas de coût d'apprentissage supplémentaire pour les caissiers déjà formés.

---

## 10. Liens

- [`../11-conventions/03-react-patterns.md`](../11-conventions/03-react-patterns.md) — section Accessibility
- [`../11-conventions/06-pitfalls.md`](../11-conventions/06-pitfalls.md) — pitfall #15 `cmdk` `shouldFilter`
- [`../02-design-system/03-shadcn-primitives.md`](../02-design-system/03-shadcn-primitives.md) — Dialog, Command, Popover
- [`../05-integrations/09-third-party-libs.md`](../05-integrations/09-third-party-libs.md) — `cmdk` lib
