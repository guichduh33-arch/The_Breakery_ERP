# 04 — Glossary

> **Last verified**: 2026-05-03

Glossaire des termes métier, techniques et acronymes utilisés dans AppGrav V2.

## Métier — Bakery / POS

| Terme | Définition |
|---|---|
| **AppGrav V2** | Le produit logiciel — ERP/POS monolith Vite+React+Supabase |
| **The Breakery** | Le client — boulangerie artisanale française à Lombok, Indonésie |
| **POS** | Point of Sale — caisse enregistreuse |
| **B2B** | Business-to-Business — ventes en gros à d'autres commerces (hôtels, restaurants partenaires) |
| **KDS** | Kitchen Display System — écran cuisine recevant les ordres à préparer |
| **Customer Display** | Écran client (`/display`) qui affiche commande + total côté client |
| **Tablet Ordering** | Interface `/tablet/*` pour commande à table par serveur |
| **Cafe Stock** | Sous-stock dédié au comptoir (différent du stock de production) |
| **Order Type** | `dine_in` · `takeaway` · `delivery` · `b2b` |
| **Locked Item** | Item de panier déjà envoyé en cuisine — modification interdite sans PIN manager |
| **Void** | Annulation d'une commande/item (requiert PIN manager) |
| **Refund** | Remboursement post-paiement (requiert PIN manager) |
| **Combo** | Pack de produits vendu à un prix unique (`product_combos`) |
| **Modifier** | Option ajoutée à un produit (taille, supplément) — peut affecter le prix |
| **Opname** | Comptage physique d'inventaire (terme indonésien — "stock count") |
| **Shift** | Période de travail d'un caissier (open → ventes → close avec variance) |
| **Production Record** | Lot de production — décrémente ingrédients, incrémente produits finis |

## Comptabilité (Indonesian)

| Terme | Définition |
|---|---|
| **PB1** | **Pajak Restoran** — taxe restaurant locale Indonésie 10 %, **incluse** dans les prix. Formula: `tax = total × 10/110`. **N'est PAS** la PPN (TVA nationale). |
| **PPN** | Pajak Pertambahan Nilai — TVA nationale, **non utilisée** ici (volontairement) |
| **DJP** | Direktorat Jenderal Pajak — administration fiscale indonésienne (pas de reporting automatique vers DJP) |
| **SAK EMKM** | Standar Akuntansi Keuangan Entitas Mikro, Kecil dan Menengah — référentiel comptable simplifié pour PME indonésiennes |
| **SAK ETAP** | Standar Akuntansi Keuangan Entitas Tanpa Akuntabilitas Publik — référentiel pour entités sans obligation publique |
| **COA** | Chart of Accounts — plan comptable (table `accounts`) |
| **JE** | Journal Entry — écriture comptable (`journal_entries` + lignes `journal_entry_lines`) |
| **GL** | General Ledger — grand livre |
| **AP** | Accounts Payable — dettes fournisseurs (compte `2100`) |
| **AR** | Accounts Receivable — créances clients |
| **COGS** | Cost of Goods Sold — coût des marchandises vendues (compte `5100`) |
| **Mapping Key** | Clé symbolique (ex. `SALE_CASH_IN`) → UUID de compte (`account_mappings`) — découple le code des UUIDs DB |
| **Idempotency Check** | Vérification qu'une JE n'est pas créée deux fois pour la même source (`source_type` + `source_id`) |
| **Fiscal Period** | Période comptable verrouillable (`fiscal_periods`) — empêche écritures sur période close |

## Comptes critiques (extraits)

| Code | Compte |
|---|---|
| 1110 | Cash on hand |
| 1120 | Bank |
| 1300 | Inventory |
| 2100 | Accounts Payable |
| 2110 | PB1 Collected (à reverser) |
| 2143 | PB1 Payable (autre composante) |
| 4100 | Sales Revenue |
| 5100 | COGS |

Plan comptable complet : [`03-database/08-seed-data.md`](../03-database/08-seed-data.md).

## Loyalty

| Terme | Définition |
|---|---|
| **Tier** | Niveau fidélité — Bronze (0 pts) · Silver (500) · Gold (2000) · Platinum (5000) |
| **Earn** | Gain de points — 1 point par 1 000 IDR dépensés |
| **Redeem** | Utilisation de points pour réduction |
| **Discount %** | Réduction automatique selon tier (0 / 5 / 8 / 10 %) |

## Architecture LAN

| Terme | Définition |
|---|---|
| **LAN Hub** | Le device principal (généralement le POS hub) qui orchestre les autres |
| **LAN Client** | Device secondaire (KDS, display, tablette) connecté au hub |
| **BroadcastChannel** | API browser native pour communication intra-origin entre tabs |
| **Realtime Channel** | Canal Supabase Realtime — fallback inter-device cross-network |
| **Heartbeat** | Ping périodique 30s — un device sans heartbeat depuis 120s est marqué stale |
| **Discovery** | Découverte automatique des devices (TCP probe → HTTP probe fallback) |
| **Print Routing** | Mécanisme par lequel un client envoie `PRINT_REQUEST` au hub qui route vers la bonne imprimante physique |
| **Lan Node** | Entrée DB (`lan_nodes`) représentant un device runtime (online/idle/offline) |
| **Device Configuration** | Persistant (`device_configurations`) — type, role, IP, port, capabilities |

## Auth & Permissions

| Terme | Définition |
|---|---|
| **PIN** | 4-6 chiffres — méthode d'auth principale (POS workflow rapide) |
| **Session** | Token Supabase JWT — durée 30 min par défaut (configurable via `pos_config`) |
| **RBAC** | Role-Based Access Control — rôles → permissions |
| **Permission Code** | `module.action` (ex. `sales.create`, `accounting.journal.create`) |
| **`is_authenticated()`** | Helper SQL STABLE caché par transaction — utilisé dans toutes les RLS |
| **`user_has_permission(uid, code)`** | Fonction SQL STABLE SECURITY DEFINER vérifiant qu'un user a une permission |
| **PermissionGuard** | Composant React `<PermissionGuard permission="...">` |
| **Module Access Guard** | Composant qui restreint l'accès à un module entier |
| **POSAccessGuard** / **BackOfficeAccessGuard** | Guards spécifiques aux deux grands espaces |

## Tech / Build

| Terme | Définition |
|---|---|
| **SPA** | Single Page Application — ici Vite + React Router |
| **PWA** | Progressive Web App — manifest + service worker via vite-plugin-pwa |
| **Edge Function** | Fonction Deno hébergée par Supabase (`supabase/functions/*`) |
| **RPC** | Remote Procedure Call — fonction PostgreSQL invoquée via `supabase.rpc('name', args)` |
| **RLS** | Row Level Security — politiques d'accès Postgres par ligne |
| **STABLE** (SQL) | Marqueur Postgres : la fonction renvoie le même résultat dans la même transaction → cacheable |
| **SECURITY DEFINER** | La fonction s'exécute avec les droits du créateur (souvent `postgres`), pas de l'appelant |
| **Generated Types** | `database.generated.ts` produit par `supabase gen types` — **ne pas éditer manuellement** |
| **Realtime** | Postgres replication → WebSocket pour broadcast aux clients abonnés |

## Conventions de code

| Terme | Définition |
|---|---|
| **`I` prefix** | Préfixe interfaces TypeScript (`IProduct`, `IOrder`) |
| **`T` prefix** | Préfixe types/aliases TypeScript (`TOrderStatus`, `TPaymentMethod`) |
| **Targeted Select** | `select('id, name, price')` au lieu de `select('*')` — performance |
| **ModuleErrorBoundary** | Error boundary par module pour isoler les crashes |

## Conformité & sécurité

| Terme | Définition |
|---|---|
| **PII** | Personally Identifiable Information — scrubbée par Sentry avant envoi |
| **Sourcemaps `hidden`** | Sourcemaps uploadées vers Sentry mais non exposées au client |
| **`verify_jwt: true`** | Config Edge Function — Supabase vérifie le JWT avant invocation |

## Liens utiles

- Conventions code complètes : [`11-conventions/01-coding-conventions.md`](../11-conventions/01-coding-conventions.md)
- Pitfalls : [`11-conventions/06-pitfalls.md`](../11-conventions/06-pitfalls.md)
- Business rules : [`12-appendices/01-business-rules.md`](../12-appendices/01-business-rules.md)
