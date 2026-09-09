# Codex — The Breakery ERP

## Consignes du projet

Lire [CLAUDE.md](CLAUDE.md) avant de travailler dans ce dépôt. Il porte les
conventions et invariants du projet, sous réserve des instructions système,
développeur et des demandes explicites de l'utilisateur.

## Skills du dépôt

Les skills métier sont dans `.claude/skills/` ; Impeccable est installé dans
`.agents/skills/impeccable/`. Cet index permet à Codex
de les utiliser directement, sans copie ni installation globale.

Avant une tâche, sélectionner les skills pertinents d'après le tableau ci-dessous,
puis lire intégralement leur `SKILL.md` avant toute modification concernée.
Leurs descriptions, `pathPatterns` et `promptSignals` précisent les déclencheurs.
Si l'utilisateur nomme un skill, le lire explicitement. Annoncer les skills utilisés.
Résoudre leurs références relatives depuis leur dossier source et ne charger
les ressources complémentaires que lorsqu'elles sont nécessaires.

| Skill | Quand le lire |
| --- | --- |
| [accounting](.claude/skills/accounting/SKILL.md) | Comptabilité, écritures, plan comptable, fiscalité, clôture et états financiers. |
| [b2b-credit](.claude/skills/b2b-credit/SKILL.md) | Commandes et factures B2B, créances, paiements et plafonds de crédit. |
| [breakery-design](.claude/skills/breakery-design/SKILL.md) | Direction artistique transverse et interfaces hors POS. |
| [breakery-ui-kit](.claude/skills/breakery-ui-kit/SKILL.md) | Avant toute écriture de JSX ou modification des composants React et tokens du projet. |
| [db-migrations](.claude/skills/db-migrations/SKILL.md) | Migrations SQL, mécanique des RPC, grants et régénération des types. |
| [edge-functions](.claude/skills/edge-functions/SKILL.md) | Edge Functions, appels clients, secrets, idempotence et limites de débit. |
| [expense-governance](.claude/skills/expense-governance/SKILL.md) | Dépenses, approbations, seuils et séparation des tâches. |
| [grill-me](.claude/skills/grill-me/SKILL.md) | Demande explicite de mise à l'épreuve d'un plan par questions. |
| [impeccable](.agents/skills/impeccable/SKILL.md) | Conception, critique, audit et finition des interfaces ; commandes Impeccable explicites. |
| [orders](.claude/skills/orders/SKILL.md) | Cycle des commandes, lignes, statuts, annulations et remboursements. |
| [playwright-cli](.claude/skills/playwright-cli/SKILL.md) | Procédure de pilotage navigateur et tests Playwright. |
| [playwright-fr](.claude/skills/playwright-fr/SKILL.md) | Vérification navigateur, captures et E2E ; complète playwright-cli. |
| [pos-design-craft](.claude/skills/pos-design-craft/SKILL.md) | Création de nouveaux écrans, composants et parcours visuels POS. |
| [pos-flow-audit](.claude/skills/pos-flow-audit/SKILL.md) | Parcours commande-paiement, caisse, serveur, cuisine et clôture de shift. |
| [pos-frontend-design-audit](.claude/skills/pos-frontend-design-audit/SKILL.md) | Audit visuel et ergonomique du POS existant, profils caisse et serveur. |
| [pos-frontend-design-implement](.claude/skills/pos-frontend-design-implement/SKILL.md) | Implémentation des propositions issues de l'audit design POS. |
| [products-catalog](.claude/skills/products-catalog/SKILL.md) | Catalogue, produits, variantes, catégories, modificateurs et vitrine. |
| [report-audit](.claude/skills/report-audit/SKILL.md) | Diagnostic des rapports, graphiques ou filtres incorrects. |
| [report-designer](.claude/skills/report-designer/SKILL.md) | Conception analytique, choix de métriques et graphiques, prototypes de rapports. |
| [reports-exports](.claude/skills/reports-exports/SKILL.md) | Construction et raccordement des rapports, exports CSV/PDF et Z-reports. |
| [security-auth](.claude/skills/security-auth/SKILL.md) | Mécanismes d'authentification, PIN, JWT, RLS et permissions. |
| [security-fraud-guard](.claude/skills/security-fraud-guard/SKILL.md) | Contrôles antifraude, flux financiers, traçabilité et exposition de données. |
| [stock-management](.claude/skills/stock-management/SKILL.md) | Stocks, achats, recettes, production, coûts et mouvements. |

Combiner les skills lorsque la tâche traverse plusieurs domaines : une RPC métier
peut nécessiter le skill du domaine, `db-migrations` et `security-auth`.
Les noms d'outils propres à Claude désignent des capacités à adapter aux outils
réellement disponibles dans Codex ; ils ne prouvent pas qu'une connexion existe.
Un skill ne donne pas, à lui seul, l'autorisation d'exécuter une action externe.

Impeccable complète les skills de design du projet. Lire aussi `breakery-ui-kit`
avant de modifier du JSX et le skill POS ou transverse adapté à la surface.
Les tokens, composants, contraintes métier et décisions du projet restent les
références pour appliquer ses recommandations.

Lorsqu'un skill est ajouté ou retiré dans `.claude/skills/` ou `.agents/skills/`,
mettre cet index à jour.
