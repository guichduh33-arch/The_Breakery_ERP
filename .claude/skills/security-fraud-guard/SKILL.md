---
name: security-fraud-guard
description: >-
  Audit antifraude Breakery : abus d’argent ou de droits, séparation des tâches, fuite de données, audit logs et intégrité des ledgers. Pour une analyse de menace ou les contrôles autorisés qui en découlent ; mécanique auth : security-auth.
---

# Security & Fraud Guard — The Breakery ERP/POS

Partir du geste abusif et prouver le chemin exploitable, ses droits et sa trace. Un constat historique doit être reproduit avant d’être présenté comme ouvert. Lire les patterns de sécurité avant tout audit ou contrôle.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Garde-fous immédiats

- PIN en header pour une EF, en argument vérifié avec verrouillage pour une RPC ; le transport seul ne prouve ni protection ni fuite.
- Tracer l’acteur en `user_profiles.id`, distinguer `metadata` et `payload`, préserver les ledgers append-only.
- Distinguer catalogue de permissions et grants éditables ; lire la matrice réelle. L’exception SUPER_ADMIN d’auto-approbation de dépense doit être tracée et ne permet pas de valider deux étapes.
- Un historique de faille corrigée évite les faux positifs ; il ne prouve pas qu’aucune régression n’existe. Vérifier le corps et les ACL vivants du chemin concerné.

## Historique des failles closes (ne pas rouvrir — garder la méthode)

Les 7 failles « verified critical » du 2026-05-31 sont soldées ; ce tableau évite qu'un audit
les re-signale et garde les correctifs traçables.

| Faille (2026-05-31) | Correctif |
|---|---|
| RPC de reversal appelables en direct via PostgREST (bypass du PIN) | `20260619000030` → régression → `20260709000010` → régression → `20260710000082/000084` ; **régresse à chaque bump, cf. Pattern 5** |
| PIN dans le corps JSON de `void-order` / `cancel-item` | migré en en-tête `x-manager-pin` ; `kiosk-issue-jwt` conforme |
| `view_b2b_invoices` / `view_ar_aging` sans `security_invoker` ; MV `mv_*` lisibles par `anon` | `20260619000020/000021` |
| Vue legacy `audit_log` écrite en parallèle + append-only sur RLS seule | vue + trigger DROPPÉS (`20260710000087/000088`) ; GRANT durci `20260619000022` |
| PII `customers` lisible sans gate `customers.read` | gate en place |
| `user_profiles.pin_hash` lisible par `authenticated` | REVOKE au niveau colonne |
| RPC PIN-in-arg sans persistance des échecs (brute-force illimité) | helper `_verify_pin_with_lockout` (`20260622000010`) + câblage sur `create_manual_je`, `approve_expense`, `sign_zreport`, `close_fiscal_period`, `complete_order` (`20260622000011..015`) |

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
