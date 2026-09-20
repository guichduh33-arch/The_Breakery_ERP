---
name: reports-exports
description: >-
  Implémenter les rapports Breakery : RPC, hooks, CSV/PDF, Z-reports et drill-down. Choix des KPIs/graphes : report-designer ; diagnostic de chiffres ou de rendu incorrects : report-audit.
---

# Reports & Exports — The Breakery ERP

Suivre donnée → hook → écran → export avec les mêmes filtres. Lire seulement le contrat du canal concerné : CSV, PDF, Z-report ou navigation.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Critical patterns (vérifiés, ne pas enfreindre)

1. **Chaque RPC report a un REVOKE pair canonique** (3 lignes : `FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES`). Vérifier que toute nouvelle RPC report suit le même bloc.

2. **`buildCsv` est IO-free et dans `packages/domain`** — ne jamais ajouter de fetch/import Supabase. `downloadCsv` déclenche le download navigateur (guard `typeof window`).

3. **`generate-pdf` rate-limit 30/min durable par IP** (helper `_shared/rate-limit.ts` → `checkRateLimitDurable` → famille RPC `record_rate_limit`). Bucket `reports-exports/` TTL 30j. Ajout d'un template = ajouter dans le registry `TEMPLATES` de `index.ts` + permission correspondante.

4. **Génération du PDF Z-report non bloquante** : l'échec de l'EF est avalé (`console.warn`) côté POS — le draft row reste en DB pour retry BO via `useGenerateZReportPdf`. Ne pas rendre le flow POS bloquant.

5. **PIN en header `x-manager-pin`, jamais en body JSON, pour les EF.** Cas des RPC : le sign/void Z-report passe par une RPC et prend le PIN en argument.

6. **L'ossature d'un report est `<ReportShell>` + `<ExportMenu>`, pas `<ExportButtons>`.**
   `ReportShell` (`features/reports/components/`) porte fil d'Ariane → bandeau (PageHeader + toolbar) → bannière d'erreur `role="alert"` unifiée → bande KPI → corps, avec `isEmpty`/`emptyState`. `ExportMenu` est **un** bouton ouvrant un menu CSV / PDF, au cran **SECONDAIRE** (l'encre va à la tuile KPI héro — The One Ink Fill Rule). Sans `reports.export`, il se **désactive et dit pourquoi**, il ne disparaît pas.
   `ExportButtons` (deux boutons ghost, masquage silencieux sans permission) est l'ancêtre : au 2026-08-31 il ne survit que dans `pages/inventory/MarginWatchPage.tsx` et `pages/inventory/StockMovementsPage.tsx`, plus son helper `exportErrorDetail` que `ExportMenu` réimporte. **Ne pas l'employer sur une page neuve, et ne pas créer de bouton export ad-hoc.**

7. **Compare period : `<PeriodControl>`.** `DateRangePickerWithCompare` **n'existe plus** — `PeriodControl` (bouton calendrier 32 px + panneau presets/plage libre, bouton « Compare » à côté porté par `aria-pressed`) l'a remplacé avec `DateRangePicker` et les deux checkbox maison du module. Le compare n'est plus l'affaire de 5 pages : il touche la large majorité des pages de rapport — pour un décompte, `grep -rl "compare" apps/backoffice/src/pages/reports/*.tsx`, jamais un nombre gravé ici. `previousPeriod` est calendar-aware (mois complet vs n-day shift).

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
