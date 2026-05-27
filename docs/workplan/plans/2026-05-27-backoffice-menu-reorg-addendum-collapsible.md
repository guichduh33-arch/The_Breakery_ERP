# Backoffice Menu Reorg — Addendum : Collapsible Subgroups

**Date :** 2026-05-27 (même journée que le plan parent)
**Branche :** `feat/bo-menu-reorg` (post Waves 0-7 du plan parent)
**Plan parent :** [`2026-05-27-backoffice-menu-reorg-plan.md`](2026-05-27-backoffice-menu-reorg-plan.md)
**Spec parent :** [`../specs/2026-05-27-backoffice-menu-reorg-spec.md`](../specs/2026-05-27-backoffice-menu-reorg-spec.md)

---

## Contexte

Suite au visual smoke check sur Wave 6.C, l'utilisateur a demandé que les sous-groupes du sidebar soient déroulables (« il faut que les category soit deroulante »). Le sidebar à 7 groupes + 9 sous-groupes nommés est dense, et certains utilisateurs n'ont pas besoin de voir en permanence Marketing reports, Audit, etc.

## Choix de scope (brainstormé 2026-05-27)

| Axe | Choix | Refusé |
|---|---|---|
| Niveau collapsible | **Subgroups uniquement** (Finance/Reports/Settings) | Top-level groups, Both |
| État par défaut | **All collapsed** au premier load | All expanded, Smart auto-expand current section |
| Persistance | **localStorage par browser** (clef `bo:sidebar:subgroups`) | Per-user DB, session-only |

**Justification :** subgroups-only = le plus petit incrément qui résout le problème de densité sans masquer des sections top-level entières. All-collapsed = sidebar la plus compacte au discovery ; l'utilisateur ouvre ce dont il a besoin et son choix persiste.

## Hors scope (YAGNI)

- Animation slide-down (`display: none` brutal suffit)
- Keyboard shortcut « ouvrir/fermer tout »
- Collapse au niveau top-level
- Migration / cleanup de la clef localStorage si corrompue (`try/catch` silent fallback à `new Set()`)
- Per-user persistence côté DB (browser local suffit pour un outil interne)

---

## Implémentation

**Fichiers modifiés (2) :**

| Path | Changes |
|---|---|
| `apps/backoffice/src/layouts/Sidebar.tsx` | (a) `useState<Set<string>>` + lazy init depuis `localStorage` (b) `useEffect` sync sur change (c) `SubgroupLabel` devient `<button>` avec chevron (d) Render branch saute les items quand sous-groupe fermé |
| `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` | Adapt 2 tests existants qui asservissent des items profonds (ils doivent maintenant cliquer le header d'abord) + 3 nouveaux tests (default-collapsed / toggle / localStorage persist) |

**Rien d'autre touché.** Pas d'export depuis `@breakery/ui`, pas de nouvelle dépendance, pas de changement de route.

### Code clef (Sidebar.tsx)

État :

```ts
const STORAGE_KEY = 'bo:sidebar:subgroups';

function readOpenSubgroups(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

const [openSubgroups, setOpenSubgroups] = useState<Set<string>>(readOpenSubgroups);

useEffect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...openSubgroups]));
  } catch {
    /* quota / private mode — silent */
  }
}, [openSubgroups]);

const toggleSubgroup = (key: string) => {
  setOpenSubgroups((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
};
```

Render branch (extrait) :

```tsx
group.subgroups!.map((sg) => {
  const key = `${group.label}::${sg.label}`;
  const isOpen = openSubgroups.has(key);
  const named = sg.label !== '';
  return (
    <div key={key} className="mb-2">
      {named && (
        <button
          type="button"
          onClick={() => toggleSubgroup(key)}
          aria-expanded={isOpen}
          className="w-full flex items-center justify-between px-6 pt-3 pb-1 text-[10px] uppercase tracking-wider text-text-muted/70 hover:text-text-primary"
        >
          <span>{sg.label}</span>
          {isOpen ? <ChevronDown className="h-3 w-3" aria-hidden /> : <ChevronRight className="h-3 w-3" aria-hidden />}
        </button>
      )}
      {(!named || isOpen) && (
        <div className="space-y-0.5">
          {sg.items.map((item) => (
            <NavItemLink key={item.to} item={item} />
          ))}
        </div>
      )}
    </div>
  );
})
```

Le `SubgroupLabel` primitive de Wave 2.B est supprimé (inlined dans le `<button>`).

### Tests

**Nouveaux :**

| Test | Vérif |
|---|---|
| `default-collapsed at first render` | `queryByText('Profit & Loss')` = `null` (item dans `Financial reports` non ouvert) ; `getByText('Financial reports')` présent (le header reste visible) |
| `clicking header expands subgroup` | `userEvent.click(getByRole('button', { name: /Expenses/i }))` → `getByText('Expense Thresholds')` devient présent ; `aria-expanded` = `true` |
| `localStorage persists state` | `localStorage.setItem(STORAGE_KEY, '["Reports::Financial reports"]')` AVANT mount → au mount, `getByText('Profit & Loss')` est présent |

**Adaptés :** les tests existants `renders all 7 top-level group labels` et `renders the renamed labels (8 renames)` qui asservissent des labels d'items profonds (sous Finance/Reports/Settings) doivent ouvrir le sous-groupe correspondant via `userEvent.click` avant l'assertion, OU pré-set localStorage. Les labels top-level + subgroup labels eux-mêmes restent visibles sans clic.

---

## Self-Review

- [x] Spec coverage : tous les axes scope clarifiés (niveau, défaut, persist) ; hors-scope listé explicitement.
- [x] Pas de placeholder TBD / TODO.
- [x] Cohérence interne : code clef + tests reflètent les choix scope (subgroups-only, default-collapsed, localStorage).
- [x] Pas d'ambiguïté : le comportement des unnamed subgroups (`label: ''`) est explicite — toujours visibles, pas de bouton.
- [x] Scope : tient en une seule modif du sidebar + son test, pas de décomposition nécessaire.

---

## Execution Notes

**Temps estimé :** 30 min.

- Wave 8.A : 5 min (ce doc + commit)
- Wave 8.B : 10 min (Sidebar.tsx)
- Wave 8.C : 10 min (tests)
- Wave 8.D : 5 min (typecheck + tests + commit)
- Wave 8.E : 2 min (CLAUDE.md bullet append)
