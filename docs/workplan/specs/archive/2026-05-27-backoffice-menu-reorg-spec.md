# Backoffice Menu Reorg — Spec

> **Date** : 2026-05-27
> **Type** : Standalone UI refactor (pas une session-N complète)
> **Branche cible suggérée** : `feat/bo-menu-reorg` (ou intégré dans une future Session-N)
> **Base** : `master` @ `ae14431` (post-S32 merge, turbo 2.9.15 bump)
> **Effort estimé** : ~2-3h wall-time (S — 1 fichier code + tests sidebar)
> **Status** : approuvé user (brainstorm 2026-05-27, transcript session `1cdf3909-2ed7-4dd9-ab4b-0b79ccffb28f`)
> **Predecessor** : aucun — première itération sur la nav BO depuis S14 Phase 4.A (commit initial `Sidebar.tsx`)

---

## 1. Contexte

`apps/backoffice/src/layouts/Sidebar.tsx` (livré S14 Phase 4.A) organise la navigation BO en **3 groupes** : `Operations` / `Management` / `Admin`. Au fil des sessions S14 → S32, ~30 entrées ont été ajoutées au gré des features, sans refondre l'organisation.

**Constat à S32 close-out** (49 entrées, audit `Sidebar.tsx:53-132`) :

1. **Groupe `Admin` surchargé** : 24 entrées hétérogènes (Reports + Accounting + Users + Settings + Print Queue + LAN Devices) — devient illisible.
2. **3 doublons de label visuel** :
   - "Categories" × 2 (`/backoffice/categories` produits vs `/backoffice/customers/categories` clients)
   - "Permissions" × 2 (`/backoffice/users/permissions` éditeur RBAC vs `/backoffice/settings/permissions` matrice read-only — duplication volontaire commentée `SettingsPermissionsPage.tsx:1-8` mais label ambigu)
   - "Settings" × 2 (`/backoffice/settings` global vs `/backoffice/b2b/settings` B2B credit)
3. **5 pages mal classées sémantiquement** :
   - `Orders` + `Customers` + `B2B Wholesale` + `Promotions` + `Loyalty` dans `Management` alors que ce sont des entités du domaine **Sales**
   - `Expenses` dans `Management` alors que c'est financier
   - `Z-Reports` dans `Management` alors que c'est une clôture caisse = compta
   - `Fiscal Periods` sous `/settings/accounting` alors que c'est de la compta
   - `Marketing reports` (Cohorts, Segments, Promo ROI, Birthdays) top-level dans `Admin` alors que ce sont des **reports**
4. **2 entrées d'autres apps** : `POS Terminal` + `Kitchen Display` sont des liens externes vers `apps/pos` — pas des pages BO.
5. **1 action déguisée en route** : `/backoffice/users/new` est listée comme entrée nav alors que `UsersListPage` a déjà le bouton "+ New user" — duplication d'UX.
6. **2 entrées orphelines top-level** : `Print Queue` + `LAN Devices` flottent dans `Admin` sans logique de regroupement.
7. **Reports** = 19 entrées indent-1 dans une liste plate — difficile à scanner.

---

## 2. Décisions structurantes

**Choix structurant 1** : **Portée limitée à `Sidebar.tsx`** — pas de modification de routes URL (`App.tsx` router config intact). Les URLs comme `/backoffice/cash-register/zreports` ou `/backoffice/settings/accounting` restent telles quelles malgré leur nouveau groupement dans le menu. Justification : minimiser le churn, préserver les bookmarks, ne pas casser les `<DrilldownLink>` S31, ne pas toucher aux tests qui pointent vers ces URLs. Backlog post-refactor : aligner les URLs avec les groupes si désiré (~20-30 fichiers).

**Choix structurant 2** : **7 groupes top-level** au lieu de 3 — `Operations` / `Sales` / `Purchase` / `Stock Management` / `Finance` / `Reports` / `Settings`. Les 6 catégories métier listées par l'utilisateur (Sales, Purchase, Stock management, Settings, Accounting, Reports) + Operations (Dashboard + Print Queue) en bandeau supérieur. **`Finance`** remplace `Accounting` comme top-level et regroupe Expenses + Accounting via 2 sous-sections internes — décision user pour vue financière unifiée.

**Choix structurant 3** : **Sous-sections visuelles internes** ajoutées comme nouveau primitive UI dans `Sidebar.tsx`. Trois niveaux de hiérarchie visuelle :
- Niveau 0 : `SectionLabel` (group label — uppercase, déjà existant)
- Niveau 1 : `SubgroupLabel` (mini-header **nouveau** — entre group et items)
- Niveau 2 : `NavItemLink` indent 0 ou 1 (déjà existant)

Utilisé dans 3 groupes :
- **Finance** — sous-sections `Expenses` + `Accounting`
- **Reports** — sous-sections `Sales` / `Inventory` / `Financial` / `Marketing` / `Audit`
- **Settings** — sous-sections `Devices` + `Users & Access`

**Choix structurant 4** : **3 drops** du menu :
- `POS Terminal` (lien external, pas BO)
- `Kitchen Display` (lien external, pas BO)
- `/backoffice/users/new` (action déguisée en route — accessible via bouton sur `UsersListPage`)

Les pages elles-mêmes restent accessibles via URL directe (pour `users/new`) ou via l'app POS (pour KDS) — seules les entrées **menu** sont retirées.

**Choix structurant 5** : **8 renames** pour éliminer les 3 doublons + clarifier 5 entrées ambiguës :

| Avant | Après | Raison |
|---|---|---|
| Categories *(products)* | Product Categories | Désambiguïse doublon |
| Categories *(customers)* | Customer Categories | Désambiguïse doublon |
| Settings *(B2B)* | B2B Credit Settings | Désambiguïse doublon |
| Z-Reports | Cash Closing (Z-Reports) | Clarifie la fonction |
| Movements *(inventory)* | Live Movements | Distingue du report |
| Stock Movements *(report)* | Stock Movement History | Distingue du live |
| Permissions *(users)* | RBAC Editor | Éditeur canonique |
| Permissions *(settings)* | Permissions Matrix (read-only) | Miroir read-only |

**Choix structurant 6** : **10 moves structurels** — voir tableau §3 ci-dessous. Aucune URL ne change, uniquement le groupement.

---

## 3. Design final

### 3.1 Structure top-level

```
Operations
├── Dashboard
└── Print Queue

Sales
├── Orders
├── Customers
│   └── Customer Categories
├── B2B Wholesale
│   ├── Payments
│   └── Credit Settings
├── Promotions
└── Loyalty

Purchase
├── Purchase Orders
└── Suppliers

Stock Management
├── Products
│   └── Product Categories
├── Stock & Inventory
├── Recipes
├── Production
├── Opname
├── Live Movements
├── Alerts
└── Sections

Finance
├── [Expenses] (subgroup label)
│   ├── Expenses
│   └── Expense Thresholds
└── [Accounting] (subgroup label)
    ├── Chart of Accounts
    ├── Journal Entries
    ├── General Ledger
    ├── Trial Balance
    ├── Account Mappings
    ├── Fiscal Periods
    └── Cash Closing (Z-Reports)

Reports
├── Hub (Reports overview)
├── [Sales reports] (subgroup label)
│   ├── Sales by Hour
│   ├── Sales by Category
│   ├── Sales by Staff
│   ├── Basket Analysis
│   └── Payment by Method
├── [Inventory reports] (subgroup label)
│   ├── Stock Variance
│   ├── Stock Movement History
│   ├── Wastage & Spoilage
│   ├── Perishable Turnover
│   └── Recipe Cost
├── [Financial reports] (subgroup label)
│   ├── Profit & Loss
│   ├── Balance Sheet
│   ├── Cash Flow
│   └── VAT / PB1
├── [Marketing reports] (subgroup label)
│   ├── Cohorts
│   ├── Segments
│   ├── Promo ROI
│   └── Birthdays
└── [Audit] (subgroup label)
    └── Audit Log

Settings
├── General settings
├── Holidays
├── Email Templates
├── Receipt Templates
├── Permissions Matrix (read-only)
├── [Devices] (subgroup label)
│   └── LAN Devices
└── [Users & Access] (subgroup label)
    ├── Users
    └── RBAC Editor
```

### 3.2 Moves structurels — table de mapping

| Page | URL (intacte) | Avant | Après |
|---|---|---|---|
| Orders | `/backoffice/orders` | Management | **Sales** |
| Customers | `/backoffice/customers` | Management | **Sales** |
| Customer Categories | `/backoffice/customers/categories` | Management (indent sous Customers) | **Sales > Customers** (indent) |
| B2B Wholesale | `/backoffice/b2b` | Management | **Sales** |
| B2B Payments | `/backoffice/b2b/payments` | Management | **Sales > B2B** (indent) |
| B2B Credit Settings | `/backoffice/b2b/settings` | Management | **Sales > B2B** (indent) |
| Promotions | `/backoffice/promotions` | Management | **Sales** |
| Loyalty | `/backoffice/loyalty` | Management | **Sales** |
| Purchase Orders | `/backoffice/purchasing/purchase-orders` (fusion avec hub `/purchasing`) | Management | **Purchase** |
| Suppliers | `/backoffice/suppliers` | Management | **Purchase** |
| Expenses | `/backoffice/expenses` | Management | **Finance > Expenses** |
| Expense Thresholds | `/backoffice/settings/expense-thresholds` | Admin > Settings | **Finance > Expenses** |
| Chart of Accounts | `/backoffice/accounting/chart-of-accounts` | Admin > Accounting | **Finance > Accounting** |
| Journal Entries | `/backoffice/accounting/journal-entries` | Admin > Accounting | **Finance > Accounting** |
| General Ledger | `/backoffice/accounting/general-ledger` | Admin > Accounting | **Finance > Accounting** |
| Trial Balance | `/backoffice/accounting/trial-balance` | Admin > Accounting | **Finance > Accounting** |
| Account Mappings | `/backoffice/accounting/mappings` | Admin > Accounting | **Finance > Accounting** |
| Fiscal Periods | `/backoffice/settings/accounting` | Admin > Settings | **Finance > Accounting** |
| Cash Closing (Z-Reports) | `/backoffice/cash-register/zreports` | Management | **Finance > Accounting** |
| Marketing reports (×4) | `/backoffice/marketing/{cohort,segments,promo-roi,birthday}` | Admin (top-level) | **Reports > Marketing reports** |
| Print Queue | `/backoffice/print-queue` | Admin (top-level) | **Operations** |
| LAN Devices | `/backoffice/lan-devices` | Admin (top-level) | **Settings > Devices** |
| Users | `/backoffice/users` | Admin > Users | **Settings > Users & Access** |
| RBAC Editor (was "Permissions") | `/backoffice/users/permissions` | Admin > Users | **Settings > Users & Access** |

### 3.3 Drops

| Entrée | URL | Raison |
|---|---|---|
| POS Terminal | `/pos` (external) | Page d'`apps/pos`, pas BO |
| Kitchen Display | `/kds` (external) | Page d'`apps/pos`, pas BO |
| "New user" | `/backoffice/users/new` | Action déjà accessible via bouton "+ New user" sur `UsersListPage` (`apps/backoffice/src/pages/users/UsersListPage.tsx:1-40`) |

### 3.4 Métriques avant/après

| Mesure | Avant | Après |
|---|---|---|
| Groupes top-level | 3 | 7 |
| Entrées nav totales | 49 | 46 |
| Sous-sections visuelles internes | 0 | 9 |
| Doublons de label | 3 | 0 |
| Pages mal classées sémantiquement | 5+ | 0 |
| Fichiers de code touchés | — | 1 (`Sidebar.tsx`) |

---

## 4. Implementation notes

### 4.1 Composant `SubgroupLabel` (nouveau primitive interne)

Pas de nouveau composant exporté de `@breakery/ui` — primitive interne à `Sidebar.tsx`. Rendu :

- Texte uppercase tracking-wide, 1 cran de moins que `SectionLabel` (group)
- Padding-left aligné avec le 1er indent (pl-6 ou pl-7 à valider visuellement)
- Couleur `text-text-muted` plus pâle que le group label
- Pas d'icône
- Pas de NavLink (juste un label visuel)

Suggested signature :

```tsx
function SubgroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-6 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-muted/70">
      {children}
    </div>
  );
}
```

### 4.2 Type model pour `NavGroup`

Le type `NavGroup` doit accepter soit un array `items: NavItem[]`, soit un array de subgroups `subgroups: { label: string; items: NavItem[] }[]`. Choix : **union discriminée** pour rester type-safe.

```ts
type NavGroup =
  | { label: string; items: NavItem[] }
  | { label: string; subgroups: { label: string; items: NavItem[] }[] };
```

Le filtre de permissions doit traverser les subgroups : un subgroup vide (toutes ses items filtrées) est masqué, et un group dont tous les subgroups sont vides est masqué entièrement.

### 4.3 Filtre de permissions — propagation

Logique actuelle (`Sidebar.tsx:179-184`) :
```ts
const visibleGroups = GROUPS.map((g) => ({
  label: g.label,
  items: g.items.filter(
    (n) => n.permission === undefined || hasPermission(n.permission),
  ),
})).filter((g) => g.items.length > 0);
```

Nouvelle logique (pseudocode) :
```ts
const visibleGroups = GROUPS.map((g) => {
  if ('items' in g) {
    const items = g.items.filter(hasPermFor);
    return items.length > 0 ? { ...g, items } : null;
  }
  // subgroups branch
  const subgroups = g.subgroups
    .map((sg) => ({ ...sg, items: sg.items.filter(hasPermFor) }))
    .filter((sg) => sg.items.length > 0);
  return subgroups.length > 0 ? { ...g, subgroups } : null;
}).filter(Boolean);
```

### 4.4 Préserver l'icône AlertsBadge

Le header de sidebar montre `AlertsBadge` à droite du `BrandMark` quand l'user a `inventory.read` (`Sidebar.tsx:201`). Comportement inchangé — pas dans le scope du refactor.

### 4.5 External links handling

Avec les drops de `POS Terminal` et `Kitchen Display`, l'attribut `external?: boolean` sur `NavItem` n'a **plus aucun consumer**. Décision : laisser le champ dans le type (compat backwards) mais retirer la branche de rendu `if (item.external === true)` (`Sidebar.tsx:142-155`) — devient dead code. Cleanup possible mais non-bloquant.

**Alternative** : retirer le champ `external` + sa branche en même temps. Plus propre, casse rien (pas de consumer externe à `Sidebar.tsx`).

---

## 5. Scope

### 5.1 Inclus

- Refonte complète de `GROUPS` dans `Sidebar.tsx:53-132`
- Ajout du primitive interne `SubgroupLabel`
- Mise à jour du type `NavGroup` (union discriminée)
- Mise à jour de la logique de filtre permissions
- Mise à jour des tests `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` :
  - Adapter les assertions sur les groupes (3 → 7)
  - Vérifier le rendu des nouveaux subgroups
  - Vérifier que les drops (POS, KDS, /users/new) n'apparaissent plus
  - Vérifier les renames (8 nouveaux labels visibles)
  - Vérifier que les permissions filtrent encore correctement

### 5.2 Hors scope (déféré post-refactor)

- **URL refactor** — aligner les URLs avec les nouveaux groupes (ex: `/backoffice/cash-register/zreports` → `/backoffice/accounting/z-reports`). Nécessiterait redirects + update de tous les `<NavLink to=...>` + tests smoke. Tracker comme item backlog si validé future session.
- **Sidebar collapse/expand** — possibilité de plier les groupes (UX nice-to-have post-refactor)
- **Sidebar search** — input de recherche en haut (ex: tape "z-report" → filtre les entrées)
- **Favorites/pinning** — épingler ses entrées les plus utilisées en haut
- **Mobile responsive sidebar** — drawer/hamburger
- **Refactor de l'app `apps/pos` sidebar** — out of scope, ce spec ne touche que BO

---

## 6. Risks / known issues

**R1 — Tests sidebar existants** : `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` peut contenir des assertions hardcoded sur les labels actuels ("Z-Reports", "Categories", "Permissions"). À adapter exhaustivement. **Mitigation** : audit complet du fichier de tests + mise à jour des snapshots si présents.

**R2 — Permission gate non testée pour les drops** : la route `/backoffice/users/new` reste accessible via URL directe. Si une page existe à ce path et n'est protégée que par le filtre du menu (peu probable), elle deviendrait "secrètement" accessible. **Mitigation** : vérifier `App.tsx` router — si la route a son propre `<PermissionGate>`, no-op.

**R3 — Cohérence visuelle des subgroup labels** : 3 niveaux de hiérarchie visuelle dans la sidebar peuvent rendre la scan moins efficace si les contrastes ne sont pas bien dosés. **Mitigation** : prototype visuel rapide avant merge — si trop "noisy", revoir le style du `SubgroupLabel`.

**R4 — User feedback inattendu sur les renames** : "Cash Closing (Z-Reports)" est plus long que "Z-Reports" — peut être trop verbeux. "RBAC Editor" vs "Permissions" — l'utilisateur peut préférer l'ancien terme. **Mitigation** : labels sont triviaux à modifier post-merge, traiter comme polish itératif.

**R5 — Field `external` orphelin** : si retiré, un consumer externe (hypothétique) casserait. Improbable car `NavItem` n'est pas exporté hors de `Sidebar.tsx`. **Mitigation** : grep `NavItem` et `external` cross-repo avant retrait.

---

## 7. Tests / validation

### 7.1 Tests unitaires à mettre à jour

- `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` — adapter aux 7 groupes + 9 subgroups + renames + drops

### 7.2 Tests fonctionnels (manuel ou automatisé)

- **Cashier role** (perms minimales) : vérifier que seul Operations + (potentiellement) une partie de Sales s'affiche
- **Manager role** : vérifier que la majorité des groupes apparaît
- **SUPER_ADMIN** : vérifier que tous les 7 groupes + tous les subgroups apparaissent
- Vérifier que cliquer sur chaque entrée nav route correctement (smoke test manuel)

### 7.3 Validation visuelle

- Screenshot avant / après pour chaque rôle
- Vérifier l'alignement vertical des subgroup labels avec les items
- Vérifier que les groupes top-level restent visuellement distincts (le SectionLabel doit dominer le SubgroupLabel)

### 7.4 Pas de DB / RPC / pgTAP impactés

Aucune migration. Aucun changement de RPC. Aucun changement de permissions seedées. Aucun fichier `supabase/` touché.

---

## 8. Open questions

Aucune à ce stade. Toutes les décisions ont été ratifiées via le brainstorm 2026-05-27.

Décisions ratifiées :
- [x] Portée (labels + groupement only, pas URLs)
- [x] POS Terminal + KDS drop
- [x] Print Queue → Operations
- [x] LAN Devices → Settings
- [x] Reports avec sous-sections internes
- [x] Finance top-level (Expenses + Accounting fusionnés)
- [x] 8 renames listés §2 choix 5
- [x] 10 moves listés §3.2
- [x] 3 drops listés §3.3

---

## 9. Prochaine étape

→ Invoquer `superpowers:writing-plans` pour produire le plan d'implémentation détaillé (Wave 1 = code, Wave 2 = tests, Wave 3 = polish visuel si nécessaire).
