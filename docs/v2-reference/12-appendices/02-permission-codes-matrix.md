# 02 — Permission codes matrix

> **Last verified**: 2026-05-03

Matrice complète des **permission codes** consommés par `usePermissions()` / `<PermissionGuard>` et leur attribution par **rôle système** par défaut.

> Source de vérité runtime : table `permissions` + table `role_permissions` + RPC `update_role_permissions(role_id, permission_ids[])`. La matrice ci-dessous reflète la **configuration par défaut** au seed initial — un admin peut customiser via `/users` → onglet "Roles".

---

## 1. Rôles système

| Rôle | Description |
|---|---|
| **Admin** | Super-utilisateur. Accès intégral, gestion users + permissions. |
| **Manager** | Responsable opérations. Void/refund, validation discounts, export reports. |
| **Cashier** | Caissier POS. Vente standard, encaissement, pas de void/refund. |
| **Cook** | Personnel cuisine. KDS uniquement, lecture menu, marquage ready. |
| **Server** | Serveur salle. Prise commande tablette, lecture menu, pas de paiement. |
| **Accountant** | Comptable. Lecture comptable, journal entries, exports financiers. |

Convention symboles :
- ✅ Permission accordée par défaut
- ❌ Permission refusée par défaut
- ⚙️ Configurable selon politique du restaurant (par défaut ❌)

---

## 2. Sales — `sales.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `sales.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| `sales.create` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `sales.void` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `sales.discount` | ✅ | ✅ | ⚙️ | ❌ | ❌ | ❌ |
| `sales.refund` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> **Note** : `sales.discount` configurable côté `pos_config.discount_pin_threshold` — au-delà du seuil, requiert PIN manager même si permission accordée.

---

## 3. Inventory — `inventory.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `inventory.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `inventory.create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `inventory.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `inventory.delete` | ✅ | ⚙️ | ❌ | ❌ | ❌ | ❌ |
| `inventory.adjust` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> `inventory.adjust` couvre stock opname, transfers, manual corrections. Toutes ces opérations génèrent un journal entry automatique (compte 1300 Inventory).

---

## 4. Products — `products.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `products.view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `products.create` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `products.update` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `products.pricing` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> `products.pricing` — modification de prix retail / wholesale / category prices. Sensible : impacte directement la marge. Manager-only par défaut.

---

## 5. Customers — `customers.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `customers.view` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| `customers.create` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ |
| `customers.update` | ✅ | ✅ | ⚙️ | ❌ | ⚙️ | ❌ |
| `customers.loyalty` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

> `customers.loyalty` — ajustement manuel des points (hors gain automatique). Réservé manager+ pour éviter les abus.

---

## 6. Reports — `reports.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `reports.sales` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `reports.inventory` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `reports.financial` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |

> Les 50+ rapports de `/reports` sont gardés par ces 3 permissions selon leur catégorie. Cf. [`04-modules/14-reports-analytics.md`](../04-modules/14-reports-analytics.md) pour le mapping report → permission.

---

## 7. Accounting — `accounting.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `accounting.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| `accounting.manage` | ✅ | ⚙️ | ❌ | ❌ | ❌ | ✅ |
| `accounting.journal.create` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `accounting.journal.update` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| `accounting.vat.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |

> **Important** : `accounting.journal.update` permet de modifier des écritures **après** émission. Très sensible — par défaut Admin + Accountant uniquement. Toute modification est tracée dans `audit_logs` avec ancien et nouveau snapshot.

---

## 8. Admin & settings — `users.*`, `settings.*`

| Permission | Admin | Manager | Cashier | Cook | Server | Accountant |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| `users.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `users.create` | ✅ | ⚙️ | ❌ | ❌ | ❌ | ❌ |
| `users.roles` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `settings.view` | ✅ | ✅ | ❌ | ❌ | ❌ | ⚙️ |
| `settings.update` | ✅ | ⚙️ | ❌ | ❌ | ❌ | ❌ |

> `users.roles` (édition matrice permissions) — Admin uniquement. Modifier ce droit sur un autre rôle = élévation de privilèges potentielle.

---

## 9. Modules complémentaires (non listés dans `CLAUDE.md` racine)

| Permission | Notes |
|---|---|
| `kitchen.view` | KDS — accordée par défaut à Admin, Manager, Cook |
| `kitchen.update` | Mark items ready — Admin, Manager, Cook |
| `purchasing.view` / `.create` / `.update` / `.receive` | Cycle PO — Admin, Manager (+ Accountant pour view) |
| `expenses.view` / `.create` / `.approve` | Workflow dépenses — `.approve` Admin + Manager |
| `b2b.view` / `.create` / `.invoice` | Workflow B2B — Admin, Manager |
| `production.view` / `.create` | Recettes & production — Admin, Manager, Cook |
| `lan.manage` | Configuration devices LAN — Admin uniquement |
| `pos.terminal.config` | Modification config terminal local — Admin |

---

## 10. Permission gates — patterns code

### Hook

```ts
import { usePermissions } from '@/hooks/usePermissions'

const { can } = usePermissions()
if (!can('sales.void')) return <NoAccessFallback />
```

### Component guard

```tsx
import { PermissionGuard } from '@/components/permissions/PermissionGuard'

<PermissionGuard permission="accounting.manage">
  <AccountingDashboard />
</PermissionGuard>
```

### Multi-permission

```tsx
<PermissionGuard permissions={['settings.view', 'settings.network']}>
  <NetworkSettings />
</PermissionGuard>
```

### Route-level

```tsx
<RouteGuard permission="users.view">
  <ModuleErrorBoundary moduleName="Users">
    <UsersPage />
  </ModuleErrorBoundary>
</RouteGuard>
```

---

## 11. RPC : `update_role_permissions`

Source de vérité pour mettre à jour la matrice :

```ts
const { error } = await supabase.rpc('update_role_permissions', {
  p_role_id: roleId,
  p_permission_ids: ['perm_uuid_1', 'perm_uuid_2', ...],
})
```

Atomique : remplace **toute** la liste des permissions du rôle. Le `before` est snapshot dans `audit_logs`.

---

## 12. RLS côté DB — pattern enforcement

Toute table sensible utilise dans ses policies :

```sql
CREATE POLICY "Permission-based update"
  ON public.orders
  FOR UPDATE
  USING (public.user_has_permission(auth.uid(), 'sales.void') AND status = 'pending')
  WITH CHECK (public.user_has_permission(auth.uid(), 'sales.void'));
```

Le check côté client (`usePermissions`) est **UX uniquement** (cacher des boutons). Le **vrai** enforcement est en RLS.

---

## 13. Liens

- [`../07-security/03-rbac-permissions.md`](../07-security/03-rbac-permissions.md) — détail RBAC
- [`../04-modules/01-auth-permissions.md`](../04-modules/01-auth-permissions.md) — module Auth
- [`../04-modules/20-users-rbac.md`](../04-modules/20-users-rbac.md) — gestion users + matrice
- [`../03-database/06-rls-policies.md`](../03-database/06-rls-policies.md) — policies RLS
- `CLAUDE.md` racine — section "Permission Codes"
