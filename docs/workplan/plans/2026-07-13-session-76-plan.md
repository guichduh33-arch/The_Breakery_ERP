# Session 76 — Solder l'inventaire ⚫ résiduel + Description v1.3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer les 6 dernières entrées de l'inventaire ⚫ (§2.3 de `docs/workplan/remise-a-plat/00-INDEX.md`) puis publier la Description v1.3 — ce qui solde les critères de sortie n°2, 3 et 5 de la remise à plat.

**Architecture:** Lot 1 (code, branche `swarm/session-76`) : 2 purges de code mort (RedeemButton, useKioskAuth kds/tablette), câblage UI des 2 RPCs B2B existants (`reconcile_b2b_balance_v1` → bandeau drift sur le B2B Dashboard ; `adjust_b2b_balance_v2` → modal PIN-gated sur la fiche client), re-statut « À venir » des 2 pages templates. **Aucune migration, aucun regen de types** — les RPCs existent déjà en base. Lot 2 (doc) : réconciliation de la checklist `00-AMENDEMENTS-V13.md` avec les livraisons S59→S76, puis rédaction de `docs/product/DESCRIPTION.md`.

**Tech Stack:** React 18 + TypeScript, TanStack Query v5, `@breakery/ui`, Vitest + testing-library (smoke), Supabase JS (`supabase.rpc`).

**Décisions propriétaire actées ce jour (2026-07-13) :**
- ⚫ #5/#6 : **purger** les 2 variantes `useKioskAuth` kds/tablette (le core `lib/kioskAuth.ts` + la variante display restent).
- ⚫ #16/#17 : **re-statuer « À venir »** (badge UI + doc v1.3 honnête) ; le câblage réel rejoint la Vague 3 (notifications / print-bridge versionné).

## Global Constraints

- pnpm 9.15 + turbo — jamais `npm`. Tests ciblés : `pnpm --filter @breakery/backoffice test <filtre-nom-de-fichier>` / `pnpm --filter @breakery/pos test <filtre>`.
- DB = Supabase cloud V3 `ikcyvlovptebroadgtvd` via MCP uniquement (pas de Docker). **Ce plan ne crée aucune migration** — si un besoin de migration apparaît, STOP et remonter au lead.
- Money-path intouché : ne pas modifier `complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v5`, ni aucune table `orders`/`order_payments`/`stock_movements`.
- Fichiers < 500 lignes. Pas de nouveau fichier doc non demandé.
- Commits conventionnels, co-author `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Les filtres vitest matchent le **nom de fichier**, pas le nom de suite (mémoire projet).
- `crypto.randomUUID()` dans un `useRef`/état pour toute clé d'idempotence (pattern S25 flavor 2).

---

### Task 0: Branche de session

**Files:** aucun.

- [ ] **Step 1: Créer la branche**

```bash
git checkout master && git pull && git checkout -b swarm/session-76
```

---

### Task 1: Purge `RedeemButton.tsx` (⚫ #14)

**Files:**
- Delete: `apps/pos/src/features/loyalty/components/RedeemButton.tsx`

**Interfaces:** aucune — composant orphelin (0 import, vérifié 2026-07-13 ; le redeem passe par `BottomActionBar`).

- [ ] **Step 1: Re-vérifier l'orphelinat puis supprimer**

```bash
grep -rn "RedeemButton" apps/ packages/ --include="*.ts" --include="*.tsx"
# Attendu : uniquement le fichier lui-même. Puis :
git rm apps/pos/src/features/loyalty/components/RedeemButton.tsx
```

- [ ] **Step 2: Typecheck + tests loyalty**

```bash
pnpm --filter @breakery/pos typecheck && pnpm --filter @breakery/pos test loyalty
```
Attendu : PASS (aucun test ne référence RedeemButton).

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(pos): purge orphan RedeemButton (inventaire ⚫ #14)"
```

---

### Task 2: Purge `useKioskAuth` KDS + tablette (⚫ #5/#6)

**Files:**
- Delete: `apps/pos/src/features/kds/hooks/useKioskAuth.ts`
- Delete: `apps/pos/src/features/tablet/hooks/useKioskAuth.ts`
- Modify: `apps/pos/src/lib/kioskAuth.ts:4` (commentaire d'en-tête)

**Interfaces:** le core partagé `lib/kioskAuth.ts` et la variante `display/hooks/useKioskAuth.ts` (consommée par `CustomerDisplayPage`) sont **conservés**.

- [ ] **Step 1: Re-vérifier qu'aucun import n'existe puis supprimer**

```bash
grep -rn "kds/hooks/useKioskAuth\|tablet/hooks/useKioskAuth" apps/ --include="*.ts" --include="*.tsx"
# Attendu : 0 résultat hors les 2 fichiers eux-mêmes. Puis :
git rm apps/pos/src/features/kds/hooks/useKioskAuth.ts apps/pos/src/features/tablet/hooks/useKioskAuth.ts
```

- [ ] **Step 2: Mettre à jour le commentaire du core**

Dans `apps/pos/src/lib/kioskAuth.ts`, remplacer la ligne 4 :

```ts
// Shared kiosk auth core used by useKioskAuth hooks in display/, kds/, tablet/.
```
par :
```ts
// Shared kiosk auth core used by the display/ useKioskAuth hook (kds/tablet
// variants purged S76 — décision propriétaire 2026-07-13, re-spécifier si besoin).
```

- [ ] **Step 3: Typecheck + suite display (la seule consommatrice)**

```bash
pnpm --filter @breakery/pos typecheck && pnpm --filter @breakery/pos test display
```
Attendu : PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "refactor(pos): purge orphan kds/tablet useKioskAuth variants (inventaire ⚫ #5/#6)"
```

---

### Task 3: Bandeau drift solde B2B sur le Dashboard (⚫ #12 — `reconcile_b2b_balance_v1`)

**Files:**
- Create: `apps/backoffice/src/features/btob/hooks/useB2bBalanceDrift.ts`
- Modify: `apps/backoffice/src/pages/btob/B2BDashboardPage.tsx`
- Test: `apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx` (étendre le mock + 1 test)

**Interfaces:**
- Consumes: RPC `reconcile_b2b_balance_v1(p_customer_id uuid DEFAULT NULL)` → `TABLE(customer_id uuid, customer_name text, cached_balance numeric, derived_balance numeric, drift numeric, has_drift boolean)`, gate `b2b.read` (P0003 sinon).
- Produces: `useB2bBalanceDrift(enabled: boolean)` → TanStack query retournant `B2bBalanceDriftRow[]` ; export `B2B_DRIFT_QK` (réutilisé par Task 4 pour l'invalidation).

- [ ] **Step 1: Étendre le mock du smoke test et écrire le test qui échoue**

Dans `apps/backoffice/src/__tests__/btob-dashboard.smoke.test.tsx` : ajouter une clé `rpc` au mock supabase (à côté de `from`) :

```ts
      rpc: async (fn: string) => {
        if (fn === 'reconcile_b2b_balance_v1') {
          return {
            data: [
              { customer_id: 'b1', customer_name: 'Hotel Kuta', cached_balance: 250000,
                derived_balance: 200000, drift: 50000, has_drift: true },
              { customer_id: 'b2', customer_name: 'Bali Organic', cached_balance: 0,
                derived_balance: 0, drift: 0, has_drift: false },
            ],
            error: null,
          };
        }
        return { data: null, error: null };
      },
```

Ajouter `'b2b.read'` aux permissions du mock authStore, puis le test :

```ts
  it('shows a balance-drift warning banner when reconcile reports drift', async () => {
    renderPage();
    expect(await screen.findByTestId('b2b-drift-banner')).toBeInTheDocument();
    expect(screen.getByTestId('b2b-drift-banner')).toHaveTextContent('Hotel Kuta');
    // le client sans drift n'apparaît pas dans le bandeau
    expect(screen.getByTestId('b2b-drift-banner')).not.toHaveTextContent('Bali Organic');
  });
```

- [ ] **Step 2: Lancer le test — vérifier l'échec**

```bash
pnpm --filter @breakery/backoffice test btob-dashboard
```
Attendu : FAIL — `Unable to find an element by: [data-testid="b2b-drift-banner"]`.

- [ ] **Step 3: Créer le hook**

`apps/backoffice/src/features/btob/hooks/useB2bBalanceDrift.ts` :

```ts
// apps/backoffice/src/features/btob/hooks/useB2bBalanceDrift.ts
//
// S76 — câblage inventaire ⚫ #12 : expose reconcile_b2b_balance_v1
// (alerte drift solde cache customers.b2b_current_balance ↔ ledger dérivé).
// Lecture pure, gate serveur b2b.read (P0003) — n'activer la query que si
// le caller a la permission pour éviter le bruit d'erreurs.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bBalanceDriftRow {
  customer_id:     string;
  customer_name:   string;
  cached_balance:  number;
  derived_balance: number;
  drift:           number;
  has_drift:       boolean;
}

export const B2B_DRIFT_QK = ['b2b', 'balance-drift'] as const;

export function useB2bBalanceDrift(enabled: boolean) {
  return useQuery({
    queryKey: B2B_DRIFT_QK,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<B2bBalanceDriftRow[]> => {
      const { data, error } = await supabase.rpc('reconcile_b2b_balance_v1');
      if (error) throw error;
      return (data ?? []) as B2bBalanceDriftRow[];
    },
  });
}
```

- [ ] **Step 4: Câbler le bandeau dans la page**

Dans `B2BDashboardPage.tsx` : ajouter les imports

```ts
import { AlertTriangle } from 'lucide-react';
import { formatIdr } from '@breakery/utils'; // déjà importé — vérifier
import { useB2bBalanceDrift } from '@/features/btob/hooks/useB2bBalanceDrift.js';
```

après `const dash = useB2bDashboard();` :

```ts
  const canReconcile = hasPermission('b2b.read');
  const driftQuery   = useB2bBalanceDrift(canReconcile);
  const drifted      = (driftQuery.data ?? []).filter((r) => r.has_drift);
```

et juste sous `<PageHeader …/>` (avant le reste du contenu) :

```tsx
      {drifted.length > 0 ? (
        <div
          data-testid="b2b-drift-banner"
          role="alert"
          className="rounded-lg border border-warning/40 bg-warning/10 p-4 space-y-1"
        >
          <div className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Balance drift detected (cache ≠ ledger) — {drifted.length} client{drifted.length > 1 ? 's' : ''}
          </div>
          <ul className="text-sm text-text-secondary">
            {drifted.map((r) => (
              <li key={r.customer_id}>
                {r.customer_name} : cached {formatIdr(r.cached_balance)} vs derived{' '}
                {formatIdr(r.derived_balance)} (drift {formatIdr(r.drift)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
```

- [ ] **Step 5: Lancer les tests — vérifier le PASS (y compris les tests existants)**

```bash
pnpm --filter @breakery/backoffice test btob-dashboard
```
Attendu : PASS, tous les tests du fichier (les anciens tests ne doivent pas casser — le mock `rpc` renvoie les 2 lignes, seul « Hotel Kuta » drift).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter @breakery/backoffice typecheck
git add -A && git commit -m "feat(backoffice): B2B balance-drift banner via reconcile_b2b_balance_v1 (inventaire ⚫ #12)"
```

---

### Task 4: Modal « Adjust B2B balance » PIN-gated sur la fiche client (⚫ #13 — `adjust_b2b_balance_v2`)

**Files:**
- Create: `apps/backoffice/src/features/btob/hooks/useAdjustB2bBalance.ts`
- Create: `apps/backoffice/src/features/btob/components/AdjustB2bBalanceModal.tsx`
- Modify: `apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx` (prop optionnelle `onAdjustBalance`)
- Modify: `apps/backoffice/src/pages/customers/customer-detail/InfoTab.tsx` (monter le modal, gate `b2b.balance.adjust`)
- Test: `apps/backoffice/src/features/btob/__tests__/adjust-b2b-balance-modal.smoke.test.tsx`

**Interfaces:**
- Consumes: RPC `adjust_b2b_balance_v2(p_customer_id uuid, p_delta numeric, p_reason text, p_manager_pin text, p_idempotency_key uuid DEFAULT NULL)` → jsonb `{ customer_id, balance_before, balance_after, delta, je_id, audit_log_id, idempotent_replay }`. Gates serveur : `b2b.balance.adjust` (P0003), PIN validé in-RPC (`invalid_pin` P0003), `p_delta ≠ 0`, `p_reason` requis, P0011 si dépassement plafond. Consumes aussi `B2B_DRIFT_QK` de Task 3.
- Produces: `useAdjustB2bBalance(customerId: string)` (mutation `{ delta, reason, managerPin }`) ; `AdjustB2bBalanceModal({ customerId, customerName, open, onClose })` ; `B2BFieldsSectionProps.onAdjustBalance?: () => void`.

**⚠️ Caveat connu (à reporter dans l'INDEX S76, pas à fixer ici) :** le PIN part en **arg RPC** (body PostgREST), pattern pré-existant S37/S38 (`sign_zreport_v2` idem) — la règle S25 « PIN en header » ne vaut que pour les EFs. Le finding F-1 S66 (lockout non persisté sur PIN-in-arg) s'applique aussi à ce RPC.

- [ ] **Step 1: Écrire le smoke test qui échoue**

`apps/backoffice/src/features/btob/__tests__/adjust-b2b-balance-modal.smoke.test.tsx` :

```tsx
// S76 — smoke du modal d'ajustement d'encours B2B (inventaire ⚫ #13).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdjustB2bBalanceModal } from '../components/AdjustB2bBalanceModal.js';

const rpcMock = vi.fn(async () => ({
  data: {
    customer_id: 'b1', balance_before: 250000, balance_after: 200000,
    delta: -50000, je_id: 'je-1', audit_log_id: 'al-1', idempotent_replay: false,
  },
  error: null,
}));

vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...(args as [])) },
}));

function renderModal(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdjustB2bBalanceModal customerId="b1" customerName="Hotel Kuta" open onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('AdjustB2bBalanceModal', () => {
  it('submits delta + reason + PIN to adjust_b2b_balance_v2 with an idempotency key', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText(/delta/i), '-50000');
    await user.type(screen.getByLabelText(/reason/i), 'write-off drift');
    await user.type(screen.getByLabelText(/manager pin/i), '123456');
    await user.click(screen.getByRole('button', { name: /adjust balance/i }));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    const [fn, args] = rpcMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe('adjust_b2b_balance_v2');
    expect(args.p_customer_id).toBe('b1');
    expect(args.p_delta).toBe(-50000);
    expect(args.p_reason).toBe('write-off drift');
    expect(args.p_manager_pin).toBe('123456');
    expect(typeof args.p_idempotency_key).toBe('string');
  });

  it('disables submit while delta is 0 or reason/PIN empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: /adjust balance/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Lancer — vérifier l'échec**

```bash
pnpm --filter @breakery/backoffice test adjust-b2b-balance-modal
```
Attendu : FAIL — module `AdjustB2bBalanceModal` introuvable.

- [ ] **Step 3: Créer le hook**

`apps/backoffice/src/features/btob/hooks/useAdjustB2bBalance.ts` :

```ts
// apps/backoffice/src/features/btob/hooks/useAdjustB2bBalance.ts
//
// S76 — câblage inventaire ⚫ #13 : adjust_b2b_balance_v2 (JE + PIN manager).
// Idempotence flavor 2 (S25) : UUID stable par intention via useRef, rotation
// après succès. PIN en arg RPC = pattern pré-existant S37 (cf. useSignZReport).

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DRIFT_QK } from './useB2bBalanceDrift.js';

export interface AdjustB2bBalanceResult {
  customer_id:       string;
  balance_before:    number;
  balance_after:     number;
  delta:             number;
  je_id:             string | null;
  audit_log_id:      string;
  idempotent_replay: boolean;
}

export interface AdjustB2bBalanceInput {
  delta:      number;
  reason:     string;
  managerPin: string;
}

export function useAdjustB2bBalance(customerId: string) {
  const qc = useQueryClient();
  const keyRef = useRef<string>(crypto.randomUUID());

  return useMutation<AdjustB2bBalanceResult, Error, AdjustB2bBalanceInput>({
    mutationFn: async ({ delta, reason, managerPin }) => {
      const { data, error } = await supabase.rpc('adjust_b2b_balance_v2', {
        p_customer_id:     customerId,
        p_delta:           delta,
        p_reason:          reason,
        p_manager_pin:     managerPin,
        p_idempotency_key: keyRef.current,
      });
      if (error) throw error;
      return data as unknown as AdjustB2bBalanceResult;
    },
    onSuccess: () => {
      keyRef.current = crypto.randomUUID(); // prochaine intention = nouvelle clé
      qc.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      qc.invalidateQueries({ queryKey: B2B_DRIFT_QK });
    },
  });
}
```

- [ ] **Step 4: Créer le modal**

`apps/backoffice/src/features/btob/components/AdjustB2bBalanceModal.tsx` — suivre les primitifs `@breakery/ui` (Dialog) et le style des modals btob existants (`RecordB2bPaymentModal.tsx` comme référence de structure). Contenu fonctionnel requis :

```tsx
// apps/backoffice/src/features/btob/components/AdjustB2bBalanceModal.tsx
//
// S76 — inventaire ⚫ #13 : ajustement manuel d'encours B2B (JE + PIN manager).

import { useState, type JSX } from 'react';
import { Dialog, Button } from '@breakery/ui';
import { useAdjustB2bBalance } from '../hooks/useAdjustB2bBalance.js';

export interface AdjustB2bBalanceModalProps {
  customerId:   string;
  customerName: string;
  open:         boolean;
  onClose:      () => void;
}

export function AdjustB2bBalanceModal({
  customerId, customerName, open, onClose,
}: AdjustB2bBalanceModalProps): JSX.Element {
  const [deltaRaw, setDeltaRaw] = useState('');
  const [reason,   setReason]   = useState('');
  const [pin,      setPin]      = useState('');
  const adjust = useAdjustB2bBalance(customerId);

  const delta = Number(deltaRaw);
  const valid = Number.isFinite(delta) && delta !== 0 && reason.trim() !== '' && /^\d{6}$/.test(pin);

  function submit(): void {
    if (!valid || adjust.isPending) return;
    adjust.mutate(
      { delta, reason: reason.trim(), managerPin: pin },
      { onSuccess: () => { setDeltaRaw(''); setReason(''); setPin(''); onClose(); } },
    );
  }

  // Rendu : Dialog titré `Adjust B2B balance — ${customerName}`, 3 champs
  // labellisés "Delta (IDR, negative = write-down)", "Reason", "Manager PIN"
  // (input type password, inputMode numeric, maxLength 6), message d'erreur
  // adjust.error?.message, bouton "Adjust balance" disabled={!valid || adjust.isPending}.
  // → écrire le JSX en suivant RecordB2bPaymentModal.tsx (mêmes classes/primitifs) ;
  //   les getByLabelText du test exigent des <label htmlFor> corrects.
  …
}
```

Le JSX exact suit les primitifs réellement exportés par `@breakery/ui` — **invoquer la skill `breakery-ui-kit` avant d'écrire le JSX** (Dialog/Sheet : vérifier l'API réelle ; pas de Select requis ici).

- [ ] **Step 5: Lancer le smoke — vérifier le PASS**

```bash
pnpm --filter @breakery/backoffice test adjust-b2b-balance-modal
```
Attendu : PASS (2 tests).

- [ ] **Step 6: Exposer le bouton sur la fiche client**

`B2BFieldsSection.tsx` : ajouter la prop optionnelle et le bouton à côté du solde :

```ts
export interface B2BFieldsSectionProps {
  values:           B2BFieldValues;
  canEdit:          boolean;
  onChange:         (next: B2BFieldValues) => void;
  onAdjustBalance?: () => void; // S76 — présent seulement si perm b2b.balance.adjust
}
```

et dans la ligne « Outstanding AR » :

```tsx
      <div className="flex items-center justify-between border-t border-border-subtle pt-3 text-sm">
        <span className="text-text-secondary">Outstanding AR</span>
        <span className="flex items-center gap-3">
          <span className="font-mono text-text-primary" data-testid="b2b-balance">{balanceDisplay}</span>
          {onAdjustBalance ? (
            <button
              type="button"
              onClick={onAdjustBalance}
              className="text-xs uppercase tracking-wide text-gold hover:underline"
            >
              Adjust…
            </button>
          ) : null}
        </span>
      </div>
```

Dans `InfoTab.tsx` (fiche client) : état `adjustOpen`, passer `onAdjustBalance={hasPermission('b2b.balance.adjust') ? () => setAdjustOpen(true) : undefined}` au `B2BFieldsSection` (uniquement pour `customer_type === 'b2b'`, déjà le cas), monter `<AdjustB2bBalanceModal customerId={…} customerName={…} open={adjustOpen} onClose={() => setAdjustOpen(false)} />`. Lire le composant avant édition pour reprendre ses conventions (source du `hasPermission` : `useAuthStore`).

- [ ] **Step 7: Suites impactées + typecheck**

```bash
pnpm --filter @breakery/backoffice test B2BFieldsSection && pnpm --filter @breakery/backoffice test CustomerDetailPage && pnpm --filter @breakery/backoffice typecheck
```
Attendu : PASS — si `CustomerDetailPage.smoke` casse sur le nouveau rendu, étendre son mock authStore plutôt que d'affaiblir l'assertion.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(backoffice): PIN-gated B2B balance adjustment on customer detail (inventaire ⚫ #13)"
```

---

### Task 5: Re-statut « À venir » des pages templates e-mails + tickets (⚫ #16/#17)

**Files:**
- Modify: `apps/backoffice/src/pages/settings/SettingsEmailTemplatesPage.tsx`
- Modify: `apps/backoffice/src/pages/settings/SettingsReceiptTemplatesPage.tsx`
- Test: smoke existants des 2 pages s'il y en a (`grep -l "EmailTemplates\|ReceiptTemplates" apps/backoffice/src/**/__tests__/`) — sinon assertion ajoutée au smoke le plus proche du dossier settings.

**Interfaces:** aucune nouvelle — bandeau informatif statique.

- [ ] **Step 1: Ajouter le bandeau sur chaque page**

En tête de contenu des deux pages (sous le PageHeader), le même pattern :

```tsx
      <div
        data-testid="templates-not-wired-banner"
        className="rounded-lg border border-border-subtle bg-bg-overlay p-3 text-sm text-text-secondary"
      >
        ⚠︎ Editing is live, but these templates are <strong>not applied yet</strong> —
        {/* page e-mails : */} no email is currently sent by the system.
        {/* page tickets : */} receipt printing does not read them yet.
        Wiring is planned (Vague 3 — notifications / versioned print-bridge).
      </div>
```
(Adapter la phrase à chaque page ; texte UI en anglais comme le reste du BO.)

- [ ] **Step 2: Vérifier le rendu par test**

Si un smoke existe pour ces pages : ajouter `expect(await screen.findByTestId('templates-not-wired-banner')).toBeInTheDocument();`. Sinon, créer `apps/backoffice/src/features/settings/__tests__/templates-not-wired-banner.smoke.test.tsx` sur le modèle des smoke settings existants (mêmes mocks supabase/authStore que `settings-notifications-page.smoke.test.tsx`), un `it` par page.

```bash
pnpm --filter @breakery/backoffice test templates
```
Attendu : PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(backoffice): honest 'not wired yet' banner on email/receipt templates pages (inventaire ⚫ #16/#17)"
```

---

### Task 6: Mise à jour des docs remise-à-plat (fin lot 1)

**Files:**
- Modify: `docs/workplan/remise-a-plat/00-INDEX.md` (§2.3 lignes 5, 6, 10, 12, 13, 14, 15, 16, 17, 18)
- Modify: `docs/workplan/remise-a-plat/09-b2b-wholesale.md`, `04-kds-kitchen.md`, `17-tablet-ordering.md`, `08-customers-loyalty.md`, `16-display-customer.md`, `19-settings-configuration.md` (bandeau « Mise à jour S76 » en tête, verdicts réconciliés)

- [ ] **Step 1: §2.3 — marquer chaque ligne**

- #5/#6 → `✅ **Purgés S76** (décision propriétaire 2026-07-13 — core lib/kioskAuth.ts + variante display conservés)`
- #10 → `✅ **Câblé** (CustomerDisplayPage l'importe — constaté S76, livré avec le split customer display S67)`
- #12 → `✅ **Câblé S76** (hook useB2bBalanceDrift + bandeau drift B2B Dashboard)`
- #13 → `✅ **Câblé S76** (AdjustB2bBalanceModal PIN-gated, fiche client)`
- #14 → `✅ **Purgé S76**`
- #15 → `✅ **Câblé S73** (tuile Settings History → /backoffice/reports/audit?action=setting.update)`
- #16/#17 → `🟡 **Re-statués S76** (décision propriétaire 2026-07-13 : bandeau « not wired yet », câblage → Vague 3 notifications / print-bridge)`
- #18 → `✅ **Câblé S73** (page BO POS Configuration)`

- [ ] **Step 2: Bandeaux fiches + critère de sortie n°5**

Ajouter en tête de chaque fiche touchée : `> **Mise à jour S76 (2026-07-13)** : …` (une ligne par changement). Dans `00-INDEX.md` §5, annoter le critère 5 : `**Inventaire ⚫ soldé S76** (16/17 re-statués par décision — plus aucun code mort ambigu)`.

- [ ] **Step 3: Commit**

```bash
git add docs/workplan/remise-a-plat && git commit -m "docs(remise-a-plat): inventaire ⚫ soldé S76 — §2.3 + bandeaux fiches"
```

---

### Task 7: Lot 2 — Réconcilier la checklist v1.3 avec S59→S76

**Files:**
- Modify: `docs/workplan/remise-a-plat/00-AMENDEMENTS-V13.md`

**Contexte critique :** la checklist a été générée au commit `5b0fa92` (2026-07-04). Depuis, S59→S75 ont livré une grande partie des branches « CODE » des items **DOC⇄CODE** — l'amendement doc correspondant change alors de sens (on documente le livré au lieu de retirer la promesse). Exemples vérifiés : module 5 B1.2 (`visible_on_pos` livré S59), module 9 B1.4 (facture PDF S68) et B1.1 (prix négocié S69), module 14 dashboard (S63), module 19 B1.7 (`enabled_payment_methods` S64) et B1.2 (Settings History S73), module 4 B1.3 (seuils réglables S75), module 12 B1.4 (3 volets + PIN S66/S67), module 23 B1.3 (E2E nightly S71), module 25 B1.3 (`auth-change-pin` headers S59), module 13 B1.4 (lignes promo ticket S60).

- [ ] **Step 1: Passer les ~70 items un par un**

Pour chaque item : vérifier l'état actuel (CLAUDE.md Active Workplan + INDEX de sessions + code au besoin) et annoter la case : `- [x] … — **résolu par code SNN** : rédiger v1.3 au présent` ou `- [ ] … — toujours valable tel quel`. **Ne pas supprimer d'items** (historique append-only) ; annoter. Ajouter en tête du fichier un bandeau : `> **Réconciliation S76 (2026-07-13)** : chaque item annoté contre l'état réel post-S75 avant rédaction de la v1.3.`

- [ ] **Step 2: Intégrer les décisions post-checklist**

Vérifier que ces décisions sont bien reflétées (elles le sont déjà pour certaines) : livraison B2B annulée (2026-07-10, module 9 B1.3 ✓ déjà annoté), lecture seule RBAC (décision 1), internet-first (décision 2), remises de palier retirées (décision 3), plafond ardoise livré S62 (décision 4), PWA purgée (décision 5), stock négatif ON (décision 6), staging = dev actuel (décision 7), re-statut templates (S76).

- [ ] **Step 3: Commit**

```bash
git add docs/workplan/remise-a-plat/00-AMENDEMENTS-V13.md && git commit -m "docs(remise-a-plat): reconcile v1.3 checklist against S59-S76 deliveries"
```

---

### Task 8: Lot 2 — Rédiger `docs/product/DESCRIPTION.md` (Description v1.3)

**Files:**
- Create: `docs/product/DESCRIPTION.md`

**⚠️ PRÉREQUIS UTILISATEUR :** le fichier source `The_Breakery_ERP_Description_v1.2.docx` (2026-07-03) n'est **pas dans le repo** (vérifié 2026-07-13). Il faut que l'utilisateur le fournisse (chemin local ou dépôt dans le repo). **Fallback si indisponible :** reconstruire chaque module depuis la section **B (« demandé par la doc »)** de sa fiche `NN-*.md` — les 25 fiches paraphrasent intégralement les revendications v1.2 — en le signalant dans le bloc « Historique des versions ».

- [ ] **Step 1: Rédiger le document selon les règles de `docs/product/README.md`**

Structure : bloc « Historique des versions » en tête (v1.3, 2026-07-13, source v1.2 + checklist réconciliée Task 7) puis les 25 modules + la sous-section « Page Orders du back-office » (item « Hors Description v1.2 » de la checklist, à rattacher au module 2 ou 14). Règles dures (README produit) :
1. Aucun nom de RPC, table ou fichier — lecteur non technique.
2. Toute revendication « aujourd'hui » vraie dans le code au moment de la publication ; sinon → « À venir ».
3. Fonctionnalité abandonnée par décision (péremption/FIFO ADR-004, livraison B2B, édition RBAC, remises de palier, mesh LAN) = **retirée**, pas « À venir ».
4. Vérification contre les fiches `NN-*.md` (+ leurs bandeaux de mise à jour Task 6).

- [ ] **Step 2: Auto-revue de conformité**

Grep de contrôle sur le fichier produit : `grep -nE "_v[0-9]+|rpc|RPC|supabase|\.tsx|\.ts\b|business_config" docs/product/DESCRIPTION.md` → attendu : **0 occurrence** (règle n°1). Relire chaque module contre le tableau §1 de l'INDEX (verdicts ✅/🟠/🔴).

- [ ] **Step 3: Commit + tag**

```bash
git add docs/product/DESCRIPTION.md && git commit -m "docs(product): publish Description v1.3 (remise-a-plat exit criterion 3)"
git tag description-v1.3
```

---

### Task 9: Closeout S76

**Files:**
- Create: `docs/workplan/plans/2026-07-13-session-76-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan)

- [ ] **Step 1: Vérification finale complète**

```bash
pnpm typecheck && pnpm build && pnpm --filter @breakery/backoffice test btob && pnpm --filter @breakery/pos test display
```
Attendu : tout vert. Invoquer `superpowers:verification-before-completion` avant toute affirmation de succès.

- [ ] **Step 2: Revue pattern-guardian**

Spawner l'agent `pattern-guardian` sur le diff de branche (`git diff master...swarm/session-76`) — attendu : 0 violation (aucune migration, money-path intouché, pas d'INSERT direct).

- [ ] **Step 3: INDEX S76 + CLAUDE.md**

INDEX : décisions du jour (purge kiosk variants, re-statut templates), déviations DEV-S76-*, dettes (au minimum : **D-1 : PIN d'`adjust_b2b_balance_v2` en arg RPC — hérite du finding F-1 S66 lockout non persisté** ; **D-2 : si la v1.3 a été reconstruite depuis les fiches faute de docx, la diff v1.2→v1.3 n'est pas auditable mot à mot**). CLAUDE.md : bump « In flight » / « Merged (latest) », passer la checklist « Garde-fou anti-dérive documentaire » complète (bandeaux fiches ✓ Task 6, pas de version RPC en dur dans un skill, liens relatifs vérifiés, pas de types regen requis — aucune migration).

- [ ] **Step 4: PR**

Invoquer `superpowers:finishing-a-development-branch`. PR unique `swarm/session-76` → master (squash), body via `--body-file` (mémoire projet : here-string riche = junk files racine).

---

## Self-Review (faite à l'écriture, 2026-07-13)

1. **Couverture** : les 6 entrées ⚫ restantes ont chacune une tâche (1→5) ; les 2 critères de sortie doc (v1.3, inventaire) ont les tâches 6-8 ; closeout tâche 9. ✓
2. **Placeholders** : le JSX complet du modal (Task 4 Step 4) est volontairement délégué à la skill `breakery-ui-kit` (l'API réelle des primitifs fait foi — écrire du JSX Dialog à l'aveugle dans le plan serait pire) ; tout le reste est en code complet. Assumé.
3. **Cohérence de types** : `B2B_DRIFT_QK` (Task 3) consommé par Task 4 ; `AdjustB2bBalanceModalProps` identique entre test (Step 1) et composant (Step 4) ; query key `['customer-detail', id]` vérifiée dans `useCustomerDetail.ts:73`. ✓
