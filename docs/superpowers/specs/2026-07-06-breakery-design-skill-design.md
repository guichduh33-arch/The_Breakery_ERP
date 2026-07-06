# Spec — Skill projet `breakery-design` (direction artistique + ergonomie)

**Date :** 2026-07-06 · **Session :** S65 (background) · **Statut :** approuvé par l'utilisateur (design présenté et validé en conversation)

## Problème

Le projet a un skill `breakery-ui-kit` (surface map des composants `@breakery/ui` + tokens) et le plugin générique `frontend-design`, mais aucune couche de **direction artistique** : quand on crée ou retouche un écran, rien ne dit quelle esthétique viser par surface (POS luxe-dark vs BO ivoire vs KDS glanceable), quels trends 2026 sont applicables à un ERP boulangerie vs gadgets à éviter, ni comment auditer un écran existant sur le plan esthétique/ergonomique.

## Décisions utilisateur (2026-07-06)

1. **Périmètre : toutes les surfaces** — POS, Backoffice, KDS, Customer Display, Tablet.
2. **Trends :** digest curaté daté + protocole de refresh (WebSearch quand choix structurant). Question Stitch/Seedance : on ne peut pas importer les capacités d'un autre modèle dans un skill texte ; on **distille la méthodologie Stitch** (design-system-first, génération de variantes avant choix) et on documente un protocole d'usage d'outils AI externes (mockups = inspiration, implémentation = tokens). Seedance (vidéo) écarté, hors volet principes motion.
3. **Posture : guide + audit** — guide les créations ET fournit une checklist d'audit applicable aux écrans existants.

## Design

### Emplacement et format

`.claude/skills/breakery-design/` :
- `SKILL.md` (~300 lignes max) — frontmatter projet (`name`, `description`, `pathPatterns`, `promptSignals`) au format des 12 skills existants.
- `references/trends.md` — digest trends daté (2026-07), séparé pour ne pas alourdir le SKILL.md et pouvoir être rafraîchi indépendamment.

### Contenu SKILL.md

1. **Positionnement** — couche direction artistique AU-DESSUS de `breakery-ui-kit` (qui reste la source pour exports/tokens) ; CLAUDE.md reste la source des patterns globaux. Ne duplique ni la surface map ni la cascade de tokens.
2. **Identité par surface** (5 surfaces) : contraintes esthétiques ET pratiques de chacune — POS (luxe-dark, tactile 44 px, gold parcimonieux, vitesse d'encaissement), BO (ivoire, densité data, hiérarchie reports, desktop souris), KDS (lisibilité 2-3 m, urgence par couleur, zéro décoratif), Customer Display (lisibilité distance, brand moment, pas d'interaction), Tablet (hybride self-service).
3. **Méthodologie AI-design (inspirée Stitch)** : design-system-first ; pour tout écran nouveau ou redesign structurant, produire 2-3 variantes (artifact HTML ou mockup) AVANT d'implémenter ; traduction systématique du gagnant en tokens — jamais de hex.
4. **Checklist audit esthétique + pratique** : hiérarchie visuelle, contraste WCAG AA, touch targets ≥ 44 px, densité d'info par surface, états loading/empty/error, motion + `prefers-reduced-motion`, cohérence tokens/thèmes.
5. **Anti-patterns** : trend plaqué sans usage, hex hardcodé, animation décorative sur la money-path, rupture des deux thèmes, primitif inexistant (renvoi ui-kit).
6. **Protocole refresh trends** : le digest est daté ; si décision esthétique structurante et digest > ~6 mois, WebSearch avant de trancher.

### Contenu references/trends.md

Digest 2026 filtré ERP/POS : chaque trend avec verdict **applicable ici / à doser / gadget à éviter** et exemple d'application Breakery. Alimenté par recherche web du 2026-07-06 (le cutoff du modèle est antérieur).

### Tests

Skill de type référence → test d'application : subagent chargé du skill doit (a) restituer la bonne direction pour une surface donnée, (b) appliquer la checklist d'audit à un écran, (c) respecter la règle variantes-avant-implémentation.

## Hors périmètre

- Aucune modification de `packages/ui` ni des apps.
- Pas de nouvel agent `.claude/agents/` (le skill auto-trigger suffit).
- Seedance/vidéo : écarté.
