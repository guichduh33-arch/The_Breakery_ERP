# Session 43 — POS Live Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** corriger les findings de l'audit POS live du 2026-06-12 (spec : [`2026-06-12-session-43-pos-audit-fixes-spec.md`](../../specs/archive/2026-06-12-session-43-pos-audit-fixes-spec.md)) — 3 P0 (remises impayables, realtime mort sous PIN-auth, fire comptoir non persisté), 4 P1, 10 P2 — en 5 waves committables indépendamment + validation E2E.

**Architecture :** Wave A = plomberie systémique (realtime setAuth, filets refetch, mapping erreurs EF + redeploys). Wave B = money path remises (alignement client↔serveur, PIN pour toute remise, feedback persistant). Wave C = fire comptoir persistant (RPC `fire_counter_order_v1` symétrique de `create_tablet_order_v2`, checkout bascule sur `pay_existing_order_v7` via `pickedUpOrderId`). Wave D = P1 (sold-out, close-shift gate, history). Wave E = P2 polish + data fixes. Wave F = E2E + sweeps.

**Tech stack :** React 18 + TanStack Query + Zustand (POS), Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (`apply_migration`/`execute_sql`/`deploy_edge_function`), pgTAP en enveloppe `BEGIN...ROLLBACK`, Vitest, Playwright. **Jamais** de Docker local (`pnpm db:reset` interdit).

**Branche :** `swarm/session-43`. Commits conventionnels, squash-merge par wave possible.

**Prérequis exécution :**
- `mcp list_migrations` → vérifier que le dernier NAME-block est `20260626000020` ; ce plan utilise `20260627000010..012`.
- Dev server POS : `pnpm --filter @breakery/app-pos dev` (port 5173).
- Baseline tests connue : suites live env-gated (S25 DEV-S25-2.A-02) échouent sans `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — ne pas confondre avec une régression.

---

## Hors scope (acté en spec §3 — ne pas implémenter)

Blind count close-shift, occupation de table avant tout ordre DB, repositionnement VKP, draft-order généralisé dès le 1er item, cleanup seed twins (fait en Stock Audit m4), E2E pairing kiosk.

---

# WAVE A — Realtime + hygiène EF (P0-2)

### Task A1 : propager le JWT au WebSocket realtime

**Files:**
- Modify: `packages/supabase/src/client.ts:35-37` (setSupabaseAccessToken), `:58-60` (setSupabaseKioskAccessToken), `:76-98` (getSupabaseClient)
- Test: `packages/supabase/src/__tests__/realtime-auth.test.ts` (create)

Contexte : le wrapper fetch custom n'authentifie que HTTP. Le WebSocket realtime s'authentifie en `anon` (révoqué S20) → zéro événement `postgres_changes`, silencieusement (P0-2, reproduit live ×2).

- [ ] **Step 1 : écrire le test qui échoue**

```ts
// packages/supabase/src/__tests__/realtime-auth.test.ts
// P0-2 (audit POS live 2026-06-12) : le JWT PIN/kiosk doit atteindre le
// WebSocket realtime via realtime.setAuth — sans ça, toutes les subscriptions
// postgres_changes tournent en anon (révoqué S20) et ne reçoivent rien.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSupabaseClient,
  resetSupabaseClient,
  setSupabaseAccessToken,
  setSupabaseKioskAccessToken,
} from '../client.js';

const CONFIG = { url: 'http://localhost:54321', anonKey: 'test-anon-key' };

describe('realtime auth propagation (P0-2)', () => {
  beforeEach(() => resetSupabaseClient());

  it('setSupabaseAccessToken forwards the token to realtime.setAuth', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    client.realtime.setAuth = ((t?: string | null) => {
      calls.push(t);
    }) as typeof client.realtime.setAuth;

    setSupabaseAccessToken('pin-jwt-123');
    expect(calls).toEqual(['pin-jwt-123']);

    setSupabaseAccessToken(null); // logout → revert to anon
    expect(calls).toEqual(['pin-jwt-123', null]);
  });

  it('setSupabaseKioskAccessToken forwards the kiosk token too', () => {
    const client = getSupabaseClient(CONFIG);
    const calls: (string | null | undefined)[] = [];
    client.realtime.setAuth = ((t?: string | null) => {
      calls.push(t);
    }) as typeof client.realtime.setAuth;

    setSupabaseKioskAccessToken('kiosk-jwt-456');
    expect(calls).toEqual(['kiosk-jwt-456']);
  });

  it('a token set BEFORE client creation is applied at creation', () => {
    setSupabaseAccessToken('early-token'); // _client is null — must not throw
    const client = getSupabaseClient(CONFIG);
    // supabase-js ≥ 2.39 expose le token courant du RealtimeClient.
    const rt = client.realtime as unknown as { accessTokenValue: string | null };
    expect(rt.accessTokenValue).toBe('early-token');
  });
});
```

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm --filter @breakery/supabase test realtime-auth`
Expected: FAIL — `calls` reste `[]` (setAuth jamais appelé) et `accessTokenValue` null.

- [ ] **Step 3 : implémenter dans `client.ts`**

```ts
export function setSupabaseAccessToken(token: string | null): void {
  _accessToken = token;
  // P0-2 (audit 2026-06-12) : le realtime roule en WebSocket, pas via le fetch
  // wrapper — sans setAuth, les subscriptions postgres_changes s'authentifient
  // en anon (révoqué S20) et ne reçoivent aucun événement.
  void _client?.realtime.setAuth(token);
}
```

Même ajout dans `setSupabaseKioskAccessToken` :

```ts
export function setSupabaseKioskAccessToken(token: string | null): void {
  _accessToken = token;
  void _client?.realtime.setAuth(token);
}
```

Dans `getSupabaseClient`, juste avant `return _client;` (après `createClient`) :

```ts
  // Reload flow : authStore réinjecte le token persisté AVANT le premier accès
  // au client — ré-applique-le au RealtimeClient fraîchement créé.
  if (_accessToken) void _client.realtime.setAuth(_accessToken);
```

- [ ] **Step 4 : re-lancer le test + typecheck**

Run: `pnpm --filter @breakery/supabase test realtime-auth && pnpm --filter @breakery/supabase typecheck`
Expected: 3/3 PASS, typecheck OK. (Si `accessTokenValue` n'existe pas dans la version installée de realtime-js, remplacer l'assertion du test 3 par un spy posé via une factory — ne PAS affaiblir les tests 1-2.)

- [ ] **Step 5 : vérification manuelle 2 onglets (obligatoire — bug realtime = repro multi-surface)**

POS onglet 1 (login PIN) + onglet 2 `/tablet` (login) : créer une commande tablette → le badge « Tablet » de l'onglet 1 doit apparaître **sans reload** en < 5 s.

- [ ] **Step 6 : commit**

```bash
git add packages/supabase/src/client.ts packages/supabase/src/__tests__/realtime-auth.test.ts
git commit -m "fix(supabase): session 43 — wave A — propagate PIN/kiosk JWT to realtime.setAuth (P0-2)"
```

### Task A2 : filets refetch sur les 2 requêtes multi-device critiques

**Files:**
- Modify: `apps/pos/src/features/inbox/hooks/usePendingTabletOrders.ts:43-44`
- Modify: `apps/pos/src/features/kds/hooks/useKdsOrders.ts` (l'unique `useQuery` du fichier)

Contexte : D1 spec — un événement realtime perdu pendant un blip Wi-Fi ne se rattrape jamais (« lost realtime event »). Filet : refetch périodique 30 s.

- [ ] **Step 1 : `usePendingTabletOrders` — ajouter l'option**

```ts
  return useQuery({
    queryKey: ['pending-tablet-orders'],
    // P0-2 filet (audit 2026-06-12) : un event realtime perdu (blip Wi-Fi,
    // reconnexion) est rattrapé en ≤ 30 s. Le realtime reste le chemin nominal.
    refetchInterval: 30_000,
    queryFn: async () => {
```

- [ ] **Step 2 : `useKdsOrders` — même option**

Ouvrir le fichier, localiser l'unique appel `useQuery({ queryKey: [...], queryFn ... })` et insérer `refetchInterval: 30_000,` (même commentaire) après `queryKey`.

- [ ] **Step 3 : sweep ciblé + typecheck**

Run: `pnpm --filter @breakery/app-pos test inbox && pnpm --filter @breakery/app-pos test kds && pnpm --filter @breakery/app-pos typecheck`
Expected: PASS (aucun test existant n'asserte l'absence de refetchInterval).

- [ ] **Step 4 : commit**

```bash
git add apps/pos/src/features/inbox/hooks/usePendingTabletOrders.ts apps/pos/src/features/kds/hooks/useKdsOrders.ts
git commit -m "fix(pos): session 43 — wave A — 30s refetch safety net on inbox + KDS queries (P0-2)"
```

### Task A3 : mapping d'erreurs EF process-payment + redeploy CORS

**Files:**
- Modify: `supabase/functions/process-payment/index.ts:238`
- Deploy: EFs `process-payment` + `auth-verify-pin` via MCP

Contexte : l'EF mappe TOUS les P0001 sur `no_open_session` → la vraie erreur (« Discount requires an authorizing manager ») est masquée. Et les EFs **déployées** ont une allowlist CORS sans `x-app` (le repo `_shared/cors.ts:4` l'a déjà — vérifié) → `functions.invoke` échoue le preflight en navigateur.

- [ ] **Step 1 : différencier les P0001 par message**

Remplacer la ligne 238 :

```ts
    if (error.code === 'P0001') {
      const msg = String(error.message ?? '');
      // v11 lève P0001 pour plusieurs gates distincts — différencie le gate
      // discount (audit 2026-06-12 P0-1) du vrai no_open_session.
      if (msg.includes('authorizing manager')) {
        return jsonResponse({ error: 'discount_requires_authorizer', message: msg }, 409);
      }
      return jsonResponse({ error: 'no_open_session', message: msg }, 409);
    }
```

- [ ] **Step 2 : redéployer les 2 EFs (embarque le cors.ts du repo avec x-app)**

Via MCP `deploy_edge_function` (project_id `ikcyvlovptebroadgtvd`) : `process-payment` puis `auth-verify-pin`. Avant deploy, `get_edge_function` sur chacune et diff vs le repo — si le déployé contient du code absent du repo, **STOP et remonter** (drift inattendu).

- [ ] **Step 3 : vérifier le preflight**

```bash
curl -s -X OPTIONS -D - -o /dev/null https://ikcyvlovptebroadgtvd.supabase.co/functions/v1/auth-verify-pin | grep -i access-control-allow-headers
```
Expected: la ligne contient `x-app` (et toujours `x-manager-pin`, `x-idempotency-key`).

- [ ] **Step 4 : commit**

```bash
git add supabase/functions/process-payment/index.ts
git commit -m "fix(edge): session 43 — wave A — distinct discount_requires_authorizer error code + redeploy CORS x-app (P0-1)"
```

---

# WAVE B — Money path remises (P0-1)

### Task B1 : `useVerifyManagerPin` en fetch brut (contourne le CORS hérité de functions.invoke)

**Files:**
- Modify: `apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts` (réécriture)
- Test: `apps/pos/src/features/discounts/__tests__/use-verify-manager-pin.test.ts` (create)

Contexte : `supabase.functions.invoke` hérite du header global `x-app` → preflight CORS rejeté par toute EF déployée avec une vieille allowlist. Les hooks EF du projet (useCheckout, useVoidOrder…) utilisent déjà le pattern fetch brut + `getAccessToken()`.

- [ ] **Step 1 : test (mock fetch)**

```ts
// apps/pos/src/features/discounts/__tests__/use-verify-manager-pin.test.ts
// P0-1c : la vérification PIN manager doit passer par fetch brut (pas
// functions.invoke qui hérite du header global x-app → CORS).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useVerifyManagerPin } from '../hooks/useVerifyManagerPin';
import { getManagerPin, clearManagerPin } from '../managerPinHolder';

vi.mock('@/lib/accessToken', () => ({ getAccessToken: vi.fn().mockResolvedValue('jwt-abc') }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'http://sb.test' }));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  clearManagerPin();
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('useVerifyManagerPin (fetch brut)', () => {
  it('POSTs to auth-verify-pin with bearer + pin body, stashes the PIN on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { verified_user_id: 'mgr-1' }));
    const verify = useVerifyManagerPin();
    const res = await verify('123456');
    expect(res).toEqual({ ok: true, userId: 'mgr-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://sb.test/functions/v1/auth-verify-pin');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-abc');
    expect(JSON.parse(init.body as string)).toEqual({ pin: '123456', required_permission: 'sales.discount' });
    expect(getManagerPin()).toBe('123456');
  });

  it('maps 403 account_locked', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'account_locked' }));
    const res = await useVerifyManagerPin()('123456');
    expect(res).toEqual({ ok: false, error: 'account_locked' });
    expect(getManagerPin()).toBeNull();
  });

  it('maps 403 sans body lockout sur permission_missing', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'permission_missing' }));
    expect(await useVerifyManagerPin()('123456')).toEqual({ ok: false, error: 'permission_missing' });
  });

  it('maps 401 sur wrong_pin', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'invalid_pin' }));
    expect(await useVerifyManagerPin()('999999')).toEqual({ ok: false, error: 'wrong_pin' });
  });

  it('maps une exception réseau sur unknown', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await useVerifyManagerPin()('123456')).toEqual({ ok: false, error: 'unknown' });
  });
});
```

Note : si `managerPinHolder` n'exporte pas `getManagerPin`/`clearManagerPin` (vérifier le fichier — `useCheckout` les importe déjà depuis `@/features/discounts/managerPinHolder`), adapter les imports du test au module réel.

- [ ] **Step 2 : lancer, vérifier l'échec** (le hook actuel appelle `supabase.functions.invoke`, pas `fetch`)

Run: `pnpm --filter @breakery/app-pos test use-verify-manager-pin`
Expected: FAIL.

- [ ] **Step 3 : réécrire le hook**

```ts
// apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts
// S43 (P0-1c) : fetch brut au lieu de supabase.functions.invoke — invoke hérite
// du header global `x-app` du client et casse le preflight CORS sur toute EF
// déployée avec une allowlist antérieure (audit navigateur 2026-06-12).
// Même pattern que useCheckout / useVoidOrder.
import { supabaseUrl } from '@/lib/supabase';
import { getAccessToken } from '@/lib/accessToken';
import type { VerifyResult } from '@breakery/ui';
import { setManagerPin } from '../managerPinHolder';

export function useVerifyManagerPin() {
  return async (pin: string): Promise<VerifyResult> => {
    try {
      const accessToken = await getAccessToken();
      const res = await fetch(`${supabaseUrl}/functions/v1/auth-verify-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ pin, required_permission: 'sales.discount' }),
      });
      const body = await res.json().catch(() => ({})) as { verified_user_id?: string; error?: string };
      if (!res.ok) {
        if (res.status === 403) {
          if ((body.error ?? '').toLowerCase() === 'account_locked') return { ok: false, error: 'account_locked' };
          return { ok: false, error: 'permission_missing' };
        }
        if (res.status === 401 || res.status === 400) return { ok: false, error: 'wrong_pin' };
        return { ok: false, error: 'unknown' };
      }
      // S37 SEC-01 — le RPC v11 re-valide ce PIN au checkout ; stash volatile
      // (cleared par useCheckout après succès).
      setManagerPin(pin);
      return { ok: true, userId: body.verified_user_id ?? '' };
    } catch {
      return { ok: false, error: 'unknown' };
    }
  };
}
```

- [ ] **Step 4 : tests + sweep discounts**

Run: `pnpm --filter @breakery/app-pos test use-verify-manager-pin && pnpm --filter @breakery/app-pos test discounts`
Expected: nouveaux 5/5 PASS, zéro régression.

- [ ] **Step 5 : commit**

```bash
git add apps/pos/src/features/discounts
git commit -m "fix(pos): session 43 — wave B — verify manager PIN via raw fetch, bypass x-app CORS inheritance (P0-1)"
```

### Task B2 : `DiscountModal` — autorisation manager pour TOUTE remise

**Files:**
- Modify: `packages/ui/src/components/DiscountModal.tsx:80-98` (handleConfirm)
- Modify: `packages/ui/src/components/__tests__/DiscountModal.test.tsx:88-160` (3 tests à inverser)

Contexte : D2 spec — le serveur (v11 l.257-277) exige un autorisateur pour toute remise ; le client ne demandait le PIN qu'au-delà de 10 % → 409 systématique sous le seuil. `isAboveThreshold` reste exporté par `@breakery/domain` mais n'est plus consommé ici.

- [ ] **Step 1 : inverser les tests existants**

Dans `DiscountModal.test.tsx` :
- Le test `'below-threshold confirm fires onConfirm directly without calling onRequireAuthorization'` (l.88) devient :

```ts
  it('below-threshold confirm STILL requires authorization (server v11 gates ALL discounts)', async () => {
    const onConfirm = vi.fn();
    const onRequireAuthorization = vi.fn().mockResolvedValue('manager-uuid-9');
    render(
      <DiscountModal
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        base={35000}
        onRequireAuthorization={onRequireAuthorization}
      />,
    );
    // 5% de 35 000 = 1 750 — sous l'ancien seuil de 10%.
    fireEvent.click(screen.getByRole('tab', { name: '%' }));
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    fireEvent.change(screen.getByPlaceholderText('Why discount?'), { target: { value: 'loyal customer' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(onRequireAuthorization).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm.mock.calls[0]![0].authorized_by).toBe('manager-uuid-9');
  });
```

(Adapter les interactions au harness réel du fichier — les tests existants l.115+ montrent le pattern exact de saisie ; réutiliser leurs helpers.)
- Les tests `'above-threshold...'` (l.115 et l.141) restent valides tels quels.

- [ ] **Step 2 : lancer, vérifier l'échec du test inversé**

Run: `pnpm --filter @breakery/ui test DiscountModal`
Expected: le nouveau test FAIL (`onRequireAuthorization` non appelé sous le seuil).

- [ ] **Step 3 : implémenter — toute remise > 0 exige l'autorisation**

Dans `handleConfirm` (`DiscountModal.tsx:80-98`), remplacer le branchement :

```ts
  async function handleConfirm(): Promise<void> {
    if (hasError || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // S43 (P0-1) : le RPC v11 exige un autorisateur pour TOUTE remise (ligne ou
      // commande) — l'ancien seuil client de 10 % produisait un 409 systématique
      // sous le seuil. isAboveThreshold n'est volontairement plus consulté ici.
      const userId = await onRequireAuthorization();
      if (userId === null) {
        onClose();
        return;
      }
      onConfirm({ ...discount, authorized_by: userId });
      handleOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }
```

Supprimer l'import `isAboveThreshold` du fichier s'il devient inutilisé.

- [ ] **Step 4 : suite complète du composant + P2-7 au passage (clés dupliquées)**

Dans le bloc qui rend la liste d'erreurs de validation (chercher `errors.map` dans `DiscountModal.tsx`), remplacer `key={e.code}` par `key={`${e.code}-${i}`}` (deux erreurs peuvent porter le même code `value_invalid` — warning React constaté live).

Run: `pnpm --filter @breakery/ui test DiscountModal && pnpm --filter @breakery/ui typecheck`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/ui/src/components/DiscountModal.tsx packages/ui/src/components/__tests__/DiscountModal.test.tsx
git commit -m "fix(ui): session 43 — wave B — manager authorization required for EVERY discount, align with RPC v11 gate (P0-1)"
```

### Task B3 : `buildOrderPayload` — remonter l'autorisateur des remises ligne au top-level

**Files:**
- Modify: `packages/domain/src/orders/buildOrderPayload.ts:76-97`
- Test: `packages/domain/src/orders/__tests__/buildOrderPayload.test.ts` (étendre — le fichier existe, sinon le créer à ce chemin)

Contexte : l'EF lit `body.discount_authorized_by` (top-level) pour le relayer en `p_discount_authorized_by` ; or une remise *ligne seule* ne portait `authorized_by` que dans l'item → le RPC voyait `v_has_discount=true` mais `p_discount_authorized_by IS NULL` → 409 même avec PIN capturé.

- [ ] **Step 1 : test**

```ts
  it('hoists the line-discount authorizer to top-level discount_authorized_by (P0-1)', () => {
    const cart: Cart = {
      order_type: 'take_out',
      items: [{
        id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1,
        modifiers: [], is_cancelled: false,
        discount: { type: 'percentage', value: 10, amount: 3500, reason: 'fidelite', authorized_by: 'mgr-7' },
      } as Cart['items'][number]],
    };
    const payload = buildOrderPayload('sess-1', cart, { method: 'cash', amount: 31500, cash_received: 31500 });
    expect(payload.discount_authorized_by).toBe('mgr-7');
    // La remise reste portée par l'item (pas dupliquée en remise commande).
    expect(payload.discount_amount).toBeUndefined();
  });
```

(Caler le shape `Cart`/`PaymentInput` sur les tests existants du fichier ; si `OrderPayload` ne déclare pas `discount_authorized_by` optionnel hors bloc cartDiscount, l'ajouter au type dans `packages/domain/src/types/`.)

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm --filter @breakery/domain test buildOrderPayload`
Expected: FAIL (`discount_authorized_by` undefined).

- [ ] **Step 3 : implémenter**

Dans `buildOrderPayload`, après le bloc `...(cart.cartDiscount ? {...} : {})` :

```ts
    // P0-1 : le RPC v11 gate TOUTE remise sur p_discount_authorized_by (top-level).
    // Quand seules des remises LIGNE existent, remonte le premier autorisateur.
    ...(!cart.cartDiscount
      ? (() => {
          const lineAuth = cart.items.find((i) => !i.is_cancelled && i.discount?.authorized_by)?.discount?.authorized_by;
          return lineAuth ? { discount_authorized_by: lineAuth } : {};
        })()
      : {}),
```

- [ ] **Step 4 : suite domain + typecheck**

Run: `pnpm --filter @breakery/domain test orders && pnpm --filter @breakery/domain typecheck`
Expected: PASS.

- [ ] **Step 5 : commit**

```bash
git add packages/domain/src
git commit -m "fix(domain): session 43 — wave B — hoist line-discount authorizer to payload top-level (P0-1)"
```

### Task B4 : feedback d'erreur persistant au paiement

**Files:**
- Modify: `packages/domain/src/payment/retryClassifier.ts:131-154` (friendlyFatalMessage)
- Modify: `apps/pos/src/features/payment/components/RetryBanner.tsx`
- Test: `packages/domain/src/payment/__tests__/retryClassifier.test.ts` (étendre), `apps/pos/src/features/payment/components/__tests__/RetryBanner.smoke.test.tsx` (étendre)

Contexte : constaté live — un 409 fatal ne laisse qu'un toast 4 s (souvent raté) ; `RetryBanner` ne rend que `retryable`/`already_paid`. Le caissier doit voir l'échec tant qu'il n'a pas agi.

- [ ] **Step 1 : tests**

retryClassifier :

```ts
    it('maps discount_requires_authorizer to a clear fatal message', () => {
      const err = Object.assign(new Error('discount_requires_authorizer'), {
        details: { error: 'discount_requires_authorizer', message: 'Discount requires an authorizing manager (p_discount_authorized_by)' },
      });
      const result = classifyCheckoutError(err);
      expect(result.kind).toBe('fatal');
      expect(result.userMessage).toMatch(/manager/i);
      expect(result.userMessage).not.toMatch(/no_open_session/);
    });
```

RetryBanner :

```ts
  it('renders a persistent banner for fatal errors (P0-1b)', () => {
    const fatal = { kind: 'fatal' as const, userMessage: 'Discount needs a manager authorization.' };
    render(<RetryBanner lastError={fatal} checkoutPending={false} onRetry={vi.fn()} onDismissAlreadyPaid={vi.fn()} />);
    expect(screen.getByText('Discount needs a manager authorization.')).toBeInTheDocument();
  });
```

- [ ] **Step 2 : lancer, vérifier les échecs**

Run: `pnpm --filter @breakery/domain test retryClassifier && pnpm --filter @breakery/app-pos test RetryBanner`
Expected: les 2 nouveaux FAIL.

- [ ] **Step 3 : implémenter**

`friendlyFatalMessage` — ajouter un case avant `case ''`:

```ts
    case 'discount_requires_authorizer':
      return 'This discount needs a manager authorization. Re-apply the discount and enter the manager PIN.';
```

`RetryBanner.tsx` — ajouter un bloc après le bloc `already_paid` (reprendre la même structure visuelle que le bloc retryable, ton rouge/erreur, sans bouton Retry) :

```tsx
  if (lastError?.kind === 'fatal') {
    return (
      <div className="rounded-md border border-red/40 bg-red-soft p-3 text-sm" role="alert" data-testid="fatal-banner">
        <p className="font-semibold text-red">Payment failed</p>
        <p className="text-text-secondary mt-1">{lastError.userMessage}</p>
      </div>
    );
  }
```

(Caler classes/structure sur le bloc retryable existant du fichier — tokens sémantiques du design system, pas de couleurs brutes nouvelles.)

- [ ] **Step 4 : suites + typecheck**

Run: `pnpm --filter @breakery/domain test payment && pnpm --filter @breakery/app-pos test payment && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5 : vérification manuelle bout-en-bout du P0-1 (les 4 fixes ensemble)**

Navigateur réel : remise ligne 10 % → modal PIN apparaît → PIN seed → checkout cash exact → **200**, SuccessModal. Puis cas négatif : Annuler le PIN → la remise n'est pas appliquée (pas de 409 possible).

- [ ] **Step 6 : commit**

```bash
git add packages/domain/src/payment apps/pos/src/features/payment
git commit -m "fix(pos,domain): session 43 — wave B — persistent fatal banner + discount error copy (P0-1)"
```

---

# WAVE C — Fire comptoir persistant (P0-3)

### Task C1 : migrations `_010` + `_011` — table d'idempotence + RPC `fire_counter_order_v1` + pgTAP

**Files:**
- Create: `supabase/migrations/20260627000010_create_counter_fire_idempotency_keys.sql`
- Create: `supabase/migrations/20260627000011_create_fire_counter_order_v1.sql`
- Create: `supabase/tests/counter_fire.test.sql`

Appliquer via MCP `apply_migration` (name = nom du fichier sans timestamp). **Avant** : `list_migrations` → confirmer prior max `20260626000020`.

- [ ] **Step 1 : migration `_010` — table d'idempotence (flavor 2, table dédiée)**

```sql
-- 20260627000010_create_counter_fire_idempotency_keys.sql
-- S43 Wave C (P0-3) — idempotence du fire comptoir (flavor 2 S25 : table dédiée).
CREATE TABLE counter_fire_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE counter_fire_idempotency_keys ENABLE ROW LEVEL SECURITY;
-- RLS sans policy + REVOKE : accès RPC-only (pattern S35 held_order_idempotency_keys).
REVOKE ALL ON counter_fire_idempotency_keys FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2 : migration `_011` — le RPC (modelé sur `create_tablet_order_v2`, migration `20260602000011`)**

```sql
-- 20260627000011_create_fire_counter_order_v1.sql
-- S43 Wave C (P0-3) — persiste le "Send to Kitchen" comptoir en DB.
-- Symétrique de create_tablet_order_v2 : mêmes inserts orders/order_items
-- (kitchen_status='pending', is_locked=true) mais created_via='pos',
-- session_id obligatoire, et mode APPEND (p_order_id) pour les fires successifs.
-- Totaux laissés à 0 comme v2 — pay_existing_order_v7 calcule le vrai total.
CREATE OR REPLACE FUNCTION fire_counter_order_v1(
  p_client_uuid  UUID,
  p_session_id   UUID,
  p_items        JSONB,
  p_order_id     UUID DEFAULT NULL,
  p_table_number TEXT DEFAULT NULL,
  p_order_type   order_type DEFAULT 'take_out'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id            UUID := auth.uid();
  v_existing_order_id  UUID;
  v_order_id           UUID := p_order_id;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_line_discount      DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  -- Replay idempotent AVANT tout write.
  SELECT order_id INTO v_existing_order_id
    FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
  IF v_existing_order_id IS NOT NULL THEN
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
  END IF;

  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Fire must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id required for counter orders' USING ERRCODE = 'check_violation';
  END IF;

  IF v_order_id IS NULL THEN
    -- CREATE : nouvel ordre comptoir pending_payment.
    INSERT INTO order_sequences (date, last_number)
      VALUES (CURRENT_DATE, 1)
      ON CONFLICT (date) DO UPDATE SET last_number = order_sequences.last_number + 1
      RETURNING last_number INTO v_seq_number;
    v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

    INSERT INTO orders (
      order_number, order_type, status, created_via, session_id,
      table_number, sent_to_kitchen_at, subtotal, tax_amount, total
    ) VALUES (
      v_order_number, p_order_type, 'pending_payment', 'pos', p_session_id,
      p_table_number, now(), 0, 0, 0
    ) RETURNING id INTO v_order_id;
  ELSE
    -- APPEND : l'ordre doit être un comptoir pending_payment de CETTE session.
    SELECT o.order_number INTO v_order_number
      FROM orders o
      WHERE o.id = p_order_id AND o.created_via = 'pos'
        AND o.status = 'pending_payment' AND o.session_id = p_session_id;
    IF v_order_number IS NULL THEN
      RAISE EXCEPTION 'Order not found or not appendable' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id    := (v_item->>'product_id')::UUID;
    v_quantity      := (v_item->>'quantity')::DECIMAL;
    v_unit_price    := (v_item->>'unit_price')::DECIMAL;
    v_modifiers     := COALESCE(v_item->'modifiers', '[]'::jsonb);
    v_line_discount := COALESCE((v_item->>'discount_amount')::DECIMAL(12,2), 0);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit FROM jsonb_array_elements(v_modifiers) m;

    v_line_total := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount;

    SELECT c.dispatch_station INTO v_dispatch_station
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    -- Silent-skip interdit (DEV-S25-1.A-03) : produit inconnu = erreur franche.
    IF NOT EXISTS (SELECT 1 FROM products p WHERE p.id = v_product_id) THEN
      RAISE EXCEPTION 'Product % not found', v_product_id USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      discount_amount, is_locked, kitchen_status, sent_to_kitchen_at
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, round_idr(v_modifiers_per_unit * v_quantity), v_dispatch_station,
      NULLIF(v_line_discount, 0), true, 'pending', now()
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  BEGIN
    INSERT INTO counter_fire_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    SELECT order_id INTO v_existing_order_id
      FROM counter_fire_idempotency_keys WHERE client_uuid = p_client_uuid;
    SELECT jsonb_build_object('order_id', o.id, 'order_number', o.order_number, 'idempotent_replay', true)
      INTO STRICT v_item FROM orders o WHERE o.id = v_existing_order_id;
    RETURN v_item;
  END;

  RETURN jsonb_build_object('order_id', v_order_id, 'order_number', v_order_number, 'idempotent_replay', false);
END $$;

-- REVOKE pair canonique S25 (PUBLIC + anon + default privileges).
GRANT EXECUTE ON FUNCTION fire_counter_order_v1(UUID, UUID, JSONB, UUID, TEXT, order_type) TO authenticated;
REVOKE EXECUTE ON FUNCTION fire_counter_order_v1(UUID, UUID, JSONB, UUID, TEXT, order_type) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
```

**Garde-fous schéma avant apply** : vérifier via `execute_sql` que (a) le CHECK `orders_session_id_required_for_pos` accepte `created_via='pos'` + `session_id` non NULL + `status='pending_payment'` (lire `pg_get_constraintdef`), (b) `order_items.discount_amount` existe (v11 l'insère — sinon retirer la colonne de l'INSERT), (c) `name_snapshot`/`modifiers_total`/`dispatch_station` matchent (copiés de v2 — déjà en prod). Si un écart apparaît : corriger la migration AVANT apply, pas de corrective préventive.

- [ ] **Step 3 : appliquer `_010` puis `_011` via MCP `apply_migration`**

- [ ] **Step 4 : pgTAP**

```sql
-- supabase/tests/counter_fire.test.sql — exécuter via MCP execute_sql, enveloppe BEGIN...ROLLBACK.
BEGIN;
SELECT plan(7);

-- Contexte : simule un caller authenticated (pattern jwt-claims des suites S37+).
SELECT set_config('role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Fixture : session + produit seed (Americano canonique BEV-AMER, cf. Stock Audit _020).
CREATE TEMP TABLE _fx AS
SELECT
  (SELECT id FROM pos_sessions WHERE status='open' ORDER BY opened_at DESC LIMIT 1) AS session_id,
  (SELECT id FROM products WHERE sku='BEV-AMER' AND deleted_at IS NULL LIMIT 1)     AS product_id;

-- T1 : create — un fire crée un ordre pending_payment created_via='pos' avec items locked.
SELECT lives_ok($$
  SELECT fire_counter_order_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-03')
$$, 'T1: fire create succeeds');

-- T2 : l'ordre existe avec le bon shape.
SELECT is(
  (SELECT count(*)::int FROM orders o
    JOIN counter_fire_idempotency_keys k ON k.order_id = o.id
    WHERE k.client_uuid = '11111111-1111-1111-1111-111111111111'
      AND o.created_via='pos' AND o.status='pending_payment' AND o.table_number='T-03'),
  1, 'T2: order row pending_payment/pos/T-03');

-- T3 : item locked + kitchen pending.
SELECT is(
  (SELECT count(*)::int FROM order_items oi
    JOIN counter_fire_idempotency_keys k ON k.order_id = oi.order_id
    WHERE k.client_uuid = '11111111-1111-1111-1111-111111111111'
      AND oi.is_locked AND oi.kitchen_status='pending' AND oi.sent_to_kitchen_at IS NOT NULL),
  1, 'T3: order_item locked/pending/sent');

-- T4 : replay même client_uuid → même ordre, pas de doublon.
SELECT is(
  ((SELECT fire_counter_order_v1(
    '11111111-1111-1111-1111-111111111111'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 1, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    NULL, 'T-03'))->>'idempotent_replay'),
  'true', 'T4: replay flagged, no duplicate order');

-- T5 : append ajoute un item au même ordre.
SELECT lives_ok($$
  SELECT fire_counter_order_v1(
    '22222222-2222-2222-2222-222222222222'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', (SELECT product_id FROM _fx), 'quantity', 2, 'unit_price', 35000, 'modifiers', '[]'::jsonb)),
    (SELECT order_id FROM counter_fire_idempotency_keys WHERE client_uuid='11111111-1111-1111-1111-111111111111'),
    'T-03')
$$, 'T5: append succeeds');
SELECT is(
  (SELECT count(*)::int FROM order_items oi
    JOIN counter_fire_idempotency_keys k ON k.order_id = oi.order_id
    WHERE k.client_uuid='11111111-1111-1111-1111-111111111111'),
  2, 'T5b: order now has 2 items');

-- T6 : produit inconnu = erreur franche P0002 (pas de silent skip).
SELECT throws_ok($$
  SELECT fire_counter_order_v1(
    '33333333-3333-3333-3333-333333333333'::uuid,
    (SELECT session_id FROM _fx),
    jsonb_build_array(jsonb_build_object(
      'product_id', '99999999-9999-9999-9999-999999999999', 'quantity', 1, 'unit_price', 1000, 'modifiers', '[]'::jsonb)))
$$, 'P0002', NULL, 'T6: unknown product raises');

SELECT * FROM finish();
ROLLBACK;
```

Run via MCP `execute_sql`. Expected: **7/7 PASS** (T1-T6 + plan). Si aucune `pos_sessions` open n'existe en dev au moment du run, en ouvrir une via le POS d'abord (ou INSERT fixture en tête de transaction).

NB anon : tester la REVOKE via `SELECT set_config('role','anon',true);` + `throws_ok` EXECUTE — l'ajouter en T7 si `plan(8)`.

- [ ] **Step 5 : types regen + commit**

MCP `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`.

```bash
git add supabase/migrations/20260627000010* supabase/migrations/20260627000011* supabase/tests/counter_fire.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): session 43 — wave C — fire_counter_order_v1 + idempotency table + pgTAP 7/7 (P0-3)"
```

### Task C2 : `useFireToStations` — RPC d'abord, impression ensuite

**Files:**
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts:89-165` (mutationFn)
- Modify: `apps/pos/src/stores/cartStore.ts` (réutilise `pickedUpOrderId` + nouveau `setPickedUpOrderId` si absent — vérifier les actions existantes du store)
- Test: `apps/pos/src/features/cart/__tests__/fire-persists-order.smoke.test.tsx` (create)

Comportement cible :
1. items unprinted → **appel RPC `fire_counter_order_v1`** avec TOUS les items unprinted non-cancelled (y compris station `none` — ils doivent exister dans l'ordre DB pour le paiement), `p_order_id = pickedUpOrderId` (append) ou NULL (create), `p_session_id` depuis `useShiftStore`, `p_table_number` depuis le cart.
2. Succès RPC → `setPickedUpOrderId(order_id)` (si create) + `markLocked` + `markPrinted` sur **tous** les items envoyés (la persistance est la source de vérité — un échec d'impression ne doit plus laisser les items « non envoyés », sinon re-fire = doublon DB).
3. Puis impression par station prep (`barista`/`kitchen`/`bakery`) comme aujourd'hui ; échec = toast `"<station> printer unreachable — ticket saved to KDS, not printed"`.
4. Le `clientUuid` du fire est généré par mutation **avant** l'appel et conservé dans un `useRef` réinitialisé sur succès — un retry réseau React-Query du même fire rejoue le même UUID (idempotence).
5. **Pas de session ouverte → erreur franche** (le RPC l'exige) ; le bouton est déjà gated par le shift guard.

- [ ] **Step 1 : test smoke (mock supabase.rpc + printService)**

```tsx
// apps/pos/src/features/cart/__tests__/fire-persists-order.smoke.test.tsx
// P0-3 : le fire comptoir doit persister AVANT d'imprimer, et marquer les items
// printed même si l'imprimante échoue (la DB est la source de vérité).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useFireToStations } from '../hooks/useFireToStations';
import { useCartStore } from '@/stores/cartStore';

const rpcMock = vi.fn().mockResolvedValue({
  data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
  error: null,
});
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => rpcMock(...a) },
  supabaseUrl: 'http://sb.test',
}));
vi.mock('@/services/print/printService', () => ({
  printStationTicket: vi.fn().mockResolvedValue({ success: false, error: 'unreachable' }),
}));
vi.mock('@/stores/shiftStore', () => ({
  useShiftStore: Object.assign(
    (sel: (s: { current: { id: string } }) => unknown) => sel({ current: { id: 'sess-1' } }),
    { getState: () => ({ current: { id: 'sess-1' } }) },
  ),
}));
vi.mock('../hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: new Map([['barista', { id: 'pr1' }]]) }),
}));
vi.mock('@/features/products/hooks/useProducts', () => ({ useProducts: () => ({ data: [] }) }));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  qc.setQueryData(['products'], [{ id: 'p1', dispatch_station: 'barista' }]);
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useFireToStations persists before printing (P0-3)', () => {
  beforeEach(() => {
    rpcMock.mockClear();
    useCartStore.setState({
      cart: {
        order_type: 'take_out',
        items: [{ id: 'l1', product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1, modifiers: [], is_cancelled: false }],
      },
      printedItemIds: [],
      lockedItemIds: [],
      pickedUpOrderId: null,
    } as Partial<ReturnType<typeof useCartStore.getState>>);
  });

  it('calls fire_counter_order_v1, sets pickedUpOrderId, marks items even when print fails', async () => {
    const { result } = renderHook(() => useFireToStations(), { wrapper });
    await act(async () => { await result.current.mutation.mutateAsync(undefined); });
    expect(rpcMock).toHaveBeenCalledWith('fire_counter_order_v1', expect.objectContaining({
      p_session_id: 'sess-1',
      p_order_id: null,
    }));
    await waitFor(() => {
      expect(useCartStore.getState().pickedUpOrderId).toBe('order-db-1');
      expect(useCartStore.getState().printedItemIds).toContain('l1');
    });
  });
});
```

(Caler les noms exacts du state cartStore — `printedItemIds`/`markLocked` existent (S34) ; vérifier `lockedItemIds` et l'action de set du `pickedUpOrderId` dans `cartStore.ts` et adapter le `setState` du test. Si `setPickedUpOrderId` n'existe pas comme action, l'ajouter au store — 3 lignes, même pattern que les actions voisines.)

- [ ] **Step 2 : lancer, vérifier l'échec** (`rpcMock` jamais appelé)

Run: `pnpm --filter @breakery/app-pos test fire-persists-order`

- [ ] **Step 3 : réécrire `mutationFn`**

Diff conceptuel complet de `useFireToStations.ts` (remplacer les étapes 1-5 actuelles de la mutationFn) :

```ts
  const fireClientUuidRef = useRef<string | null>(null);

  const mutation = useMutation<StationFireResult[], Error, FireContext | undefined>({
    mutationFn: async (ctx) => {
      const { orderNumber, tableNumber } = ctx ?? {};

      const unprinted = useCartStore.getState().unprintedItems();
      if (unprinted.length === 0) return [];

      const sessionId = useShiftStore.getState().current?.id;
      if (!sessionId) throw new Error('no_open_shift');

      // P0-3 : persistance d'abord. Même clientUuid conservé pour un retry
      // du même fire (idempotence flavor 2).
      fireClientUuidRef.current ??= crypto.randomUUID();
      const existingOrderId = useCartStore.getState().pickedUpOrderId;
      const { data, error } = await supabase.rpc('fire_counter_order_v1', {
        p_client_uuid: fireClientUuidRef.current,
        p_session_id: sessionId,
        p_items: unprinted.map((i) => ({
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: i.unit_price,
          modifiers: i.modifiers,
          ...(i.discount ? { discount_amount: i.discount.amount } : {}),
        })),
        p_order_id: existingOrderId,
        p_table_number: tableNumber ?? useCartStore.getState().cart.tableNumber ?? null,
        p_order_type: useCartStore.getState().cart.order_type,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      const env = data as unknown as { order_id: string; order_number: string };

      fireClientUuidRef.current = null; // succès → prochain fire = nouvel UUID
      if (!existingOrderId) useCartStore.getState().setPickedUpOrderId(env.order_id);

      // La DB est la source de vérité : tous les items envoyés sont scellés,
      // que l'impression réussisse ou non (sinon re-fire = doublon DB).
      const allIds = unprinted.map((i) => i.id);
      useCartStore.getState().markLocked(allIds);
      useCartStore.getState().markPrinted(allIds);

      // Impression par station prep (best effort, l'échec n'invalide rien).
      const cachedProducts = queryClient.getQueryData<Product[]>(['products']) ?? [];
      const grouped = groupItemsByStation(unprinted, buildStationMap(cachedProducts));
      const entries = Object.entries(grouped) as [PrepStation, typeof unprinted][];
      const results = await Promise.all(entries.map(async ([station, items]): Promise<StationFireResult> => {
        const itemIds = items.map((i) => i.id);
        const printer = printersMap?.get(station as PrinterRole);
        if (!printer) return { role: station, ok: false, error: 'no_printer', itemIds };
        const payload: StationTicketPayload = {
          kind: 'prep',
          role: station as PrinterRole,
          order_number: orderNumber ?? env.order_number,
          ...(tableNumber !== undefined ? { table_number: tableNumber } : {}),
          created_at: new Date().toISOString(),
          server_name: serverName,
          items: items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            modifiers: item.modifiers.map((m) => m.option_label),
          })),
        };
        const { success, error: perr } = await printStationTicket(printer, payload);
        return { role: station, ok: success, ...(perr !== undefined ? { error: perr } : {}), itemIds };
      }));
      return results;
    },
  });
```

Imports à ajouter : `useRef` (react), `supabase` (`@/lib/supabase`), `useShiftStore` (`@/stores/shiftStore`). Ajuster le toast côté caller (`SendToKitchenButton` / `usePaymentFlowLogic:148`) : copy `"<station> printer unreachable — ticket saved to KDS, not printed"`.

Si `cartStore` n'a pas d'action `setPickedUpOrderId`, l'ajouter (à côté des actions pickup existantes — `usePickupTabletOrder.ts:67` montre comment le store est peuplé aujourd'hui).

- [ ] **Step 4 : tests + sweep cart**

Run: `pnpm --filter @breakery/app-pos test fire-persists-order && pnpm --filter @breakery/app-pos test cart`
Expected: nouveau PASS ; les smokes existants du fire (`void-post-kitchen`, etc.) peuvent nécessiter le mock `supabase.rpc` + `shiftStore` — les mettre à jour, PAS les supprimer.

- [ ] **Step 5 : commit**

```bash
git add apps/pos/src/features/cart apps/pos/src/stores/cartStore.ts
git commit -m "feat(pos): session 43 — wave C — counter fire persists via fire_counter_order_v1 before printing (P0-3)"
```

### Task C3 : checkout d'un ordre fired — append des items non synchronisés puis `pay_existing_order_v7`

**Files:**
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts:68` (branche pickedUpOrderId)
- Modify: `apps/pos/src/features/cart/BottomActionBar.tsx` (Hold désactivé si `pickedUpOrderId`)
- Test: `apps/pos/src/features/payment/__tests__/checkout-fired-order-sync.smoke.test.tsx` (create)

Contexte : une fois fired, l'ordre DB est payé par `pay_existing_order_v7` (chemin pickup existant). Les items ajoutés au panier APRÈS le dernier fire n'existent pas en DB → il faut les appender avant de payer, sinon le client paie un total partiel.

- [ ] **Step 1 : test**

```tsx
// Vérifie : checkout avec pickedUpOrderId + items non-locked → un appel
// fire_counter_order_v1 (append) AVANT pay_existing_order_v7.
// Harness : reprendre le setup de mocks du smoke test golden-path
// (apps/pos/src/__tests__/golden-path.smoke.test.tsx:420-460) — cart avec
// pickedUpOrderId: 'order-db-1', un item locked l1 + un item frais l2.
// Assertions :
//   expect(rpcCalls.map(c => c[0])).toEqual(['fire_counter_order_v1', 'pay_existing_order_v7']);
//   expect(rpcCalls[0][1].p_order_id).toBe('order-db-1');
//   expect(rpcCalls[0][1].p_items).toHaveLength(1); // seulement l2
```

Écrire le test complet en copiant le harness golden-path (mocks supabase/shiftStore/managerPinHolder déjà en place dans ce fichier — réutiliser ses helpers, ne pas réinventer).

- [ ] **Step 2 : lancer, vérifier l'échec**

Run: `pnpm --filter @breakery/app-pos test checkout-fired-order-sync`

- [ ] **Step 3 : implémenter dans `useCheckout`**

Au début de la branche `if (pickedUpOrderId) {` (ligne 68), avant la construction des `args` :

```ts
        // P0-3 : si des items ont été ajoutés après le dernier fire (non locked),
        // appende-les à l'ordre DB avant de payer — pay_existing paie les
        // order_items persistés, pas le panier local.
        const lockedIds = useCartStore.getState().printedItemIds;
        const unsynced = input.cart.items.filter((i) => !i.is_cancelled && !lockedIds.includes(i.id));
        if (unsynced.length > 0 && sessionId) {
          const { error: appendErr } = await supabase.rpc('fire_counter_order_v1', {
            p_client_uuid: crypto.randomUUID(),
            p_session_id: sessionId,
            p_items: unsynced.map((i) => ({
              product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price,
              modifiers: i.modifiers,
              ...(i.discount ? { discount_amount: i.discount.amount } : {}),
            })),
            p_order_id: pickedUpOrderId,
          });
          if (appendErr) throw Object.assign(new Error(appendErr.message), { details: appendErr });
        }
```

Garde : ce bloc ne doit s'exécuter QUE pour les ordres comptoir — un pickup tablette a tous ses items en DB et `printedItemIds` vide. Condition robuste : n'appender que si `unsynced.length > 0` ET l'append échoue en P0002 pour un ordre tablette (created_via='tablet' rejeté par le RPC) — donc préfixer : `const isCounterFired = lockedIds.length > 0;` et exiger `isCounterFired`. Documenter dans le code.

- [ ] **Step 4 : Hold désactivé sur un ordre fired**

Dans `BottomActionBar.tsx`, localiser le bouton/menuitem Hold (menu « More ») et ajouter `disabled` quand `useCartStore((s) => s.pickedUpOrderId) !== null`, avec `title="Order already sent to kitchen — pay or void it"`.

- [ ] **Step 5 : suites + vérification manuelle**

Run: `pnpm --filter @breakery/app-pos test payment && pnpm --filter @breakery/app-pos test cart && pnpm typecheck`

Manuel (navigateur, V3 dev) : panier 1 Americano → Send to Kitchen → vérifier en SQL l'ordre `pending_payment` + reload POS → KDS affiche le ticket → ajouter 1 Croissant → Checkout cash exact → 200 ; vérifier en SQL : **un seul ordre**, 2 items, status `paid`. Double-tap rapide sur Send → toujours 1 ordre.

- [ ] **Step 6 : commit**

```bash
git add apps/pos/src/features/payment apps/pos/src/features/cart
git commit -m "feat(pos): session 43 — wave C — checkout syncs unfired items then pays the fired order via pay_existing_order_v7 (P0-3)"
```

---

# WAVE D — P1

### Task D1 : règle sold-out — `track_inventory` + `display_stock`

**Files:**
- Modify: `apps/pos/src/features/products/hooks/useProducts.ts:22-69`
- Modify: `apps/pos/src/features/products/ProductGrid.tsx:112`
- Modify: `packages/domain/src/types/product.ts:6-28` (+2 champs optionnels)
- Test: `apps/pos/src/features/products/__tests__/sellability.test.ts` (create)

- [ ] **Step 1 : étendre le type domain**

```ts
  // S43 (P1-1) — sellability POS. `track_inventory=false` (boissons à la minute)
  // n'est jamais sold out ; sinon le compteur vitrine display_stock prime,
  // fallback current_stock quand aucune ligne vitrine n'existe.
  track_inventory?: boolean;
  is_sellable?: boolean;
```

- [ ] **Step 2 : test de la dérivation (fonction pure extraite)**

Extraire la règle en helper exporté dans `useProducts.ts` (ou `packages/domain` si on veut l'unit-tester IO-free — préférer domain) :

```ts
// packages/domain/src/products/sellability.ts
export function isSellable(track_inventory: boolean | undefined, displayQty: number | null, current_stock: number): boolean {
  if (track_inventory === false) return true;
  const qty = displayQty ?? current_stock;
  return qty > 0;
}
```

```ts
// packages/domain/src/products/__tests__/sellability.test.ts
import { describe, it, expect } from 'vitest';
import { isSellable } from '../sellability.js';

describe('isSellable (P1-1)', () => {
  it('untracked product is always sellable even at 0 stock', () => {
    expect(isSellable(false, null, 0)).toBe(true);
  });
  it('tracked product uses display_stock when a vitrine row exists', () => {
    expect(isSellable(true, 3, 0)).toBe(true);
    expect(isSellable(true, 0, 50)).toBe(false);
  });
  it('tracked product falls back to current_stock without vitrine row', () => {
    expect(isSellable(true, null, 2)).toBe(true);
    expect(isSellable(true, null, 0)).toBe(false);
  });
  it('undefined track_inventory (legacy rows) behaves as tracked', () => {
    expect(isSellable(undefined, null, 0)).toBe(false);
  });
});
```

Exporter depuis `packages/domain/src/index.ts`.

- [ ] **Step 3 : lancer (FAIL : module absent), implémenter, re-lancer (PASS)**

Run: `pnpm --filter @breakery/domain test sellability`

- [ ] **Step 4 : câbler `useProducts`**

Étendre le select : `'..., current_stock, is_active, is_favorite, track_inventory, parent_product_id, categories(dispatch_station), display_stock(quantity)'` — vérifier d'abord via `execute_sql` que `display_stock.product_id` a bien une FK vers `products` (sinon embed impossible → 2e query par lot d'ids, même pattern que la query variants du fichier). Dans le `.map` final :

```ts
        const dsRaw = (raw as unknown as { display_stock: { quantity: number } | { quantity: number }[] | null }).display_stock;
        const ds = Array.isArray(dsRaw) ? (dsRaw[0] ?? null) : dsRaw;
        return {
          ...(p as unknown as Product),
          has_variants: parentIds.has(p.id),
          dispatch_station,
          is_sellable: isSellable(
            (p as { track_inventory?: boolean }).track_inventory,
            ds?.quantity ?? null,
            (p as { current_stock: number }).current_stock,
          ),
        };
```

- [ ] **Step 5 : câbler la grille**

`ProductGrid.tsx:112` : `const soldOut = p.is_sellable === false;` (la grille tablette consomme le même hook — vérifier par grep `useProducts(` dans `apps/pos/src/features/tablet/` que c'est bien le cas ; si la tablette a sa propre dérivation `current_stock`, appliquer le même remplacement).

- [ ] **Step 6 : suites + vérification visuelle**

Run: `pnpm --filter @breakery/app-pos test products && pnpm typecheck`
Manuel : la catégorie Beverage du dev doit montrer les boissons `track_inventory=false` tapables. (Si le seed dev a tout en `track_inventory=true`, vérifier avec un produit flippé à la main via BO.)

- [ ] **Step 7 : commit**

```bash
git add packages/domain/src apps/pos/src/features/products
git commit -m "fix(pos,domain): session 43 — wave D — sellability rule: track_inventory + display_stock first (P1-1)"
```

### Task D2 : close shift — note obligatoire au-delà du seuil de variance

**Files:**
- Modify: `apps/pos/src/features/shift/components/CloseShiftModal.tsx:122-135`
- Test: `apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx` (étendre)

- [ ] **Step 1 : test**

```tsx
  it('blocks closing on above-threshold variance without a note (P1-2)', () => {
    render(
      <CloseShiftModal open sessionId="s1" expectedCash={570000}
        thresholdAbs={50000} thresholdPct={0.005} onClose={vi.fn()} />,
    );
    // Compte 500 000 → variance -70 000 > seuil abs 50 000.
    for (const d of '500000') fireEvent.click(screen.getByRole('button', { name: d }));
    expect(screen.getByRole('button', { name: /close shift/i })).toBeDisabled();
    expect(screen.getByText(/note .*(required|obligatoire)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'till miscount, recount pending' } });
    expect(screen.getByRole('button', { name: /close shift/i })).toBeEnabled();
  });
```

(Numpad : si les digits répétés rendent le `getByRole` ambigu, utiliser le pattern de saisie des tests existants du fichier.)

- [ ] **Step 2 : lancer, vérifier l'échec ; Step 3 : implémenter**

Dans le composant, après le calcul de `variance` :

```ts
  const overThreshold =
    Math.abs(variance) > thresholdAbs
    || (expectedCash > 0 && Math.abs(variance) / expectedCash > thresholdPct);
  const noteRequired = amountStr !== '' && overThreshold && notes.trim() === '';
```

Bouton : `disabled={closeMut.isPending || amountStr === '' || noteRequired}`. Sous le textarea, quand `noteRequired` :

```tsx
  {noteRequired && (
    <p className="text-xs text-red" role="alert">
      Variance above threshold — a note explaining the difference is required.
    </p>
  )}
```

Et le label passe de « optional » à dynamique : `Notes {overThreshold ? '(required — variance above threshold)' : '(optional — variance reason, manager override)'}`.

- [ ] **Step 4 : suite + commit**

Run: `pnpm --filter @breakery/app-pos test CloseShiftModal`

```bash
git add apps/pos/src/features/shift
git commit -m "fix(pos): session 43 — wave D — close shift requires a note above variance threshold (P1-2)"
```

### Task D3 : Transaction History — refetch à l'ouverture + Remaining correct

**Files:**
- Modify: `apps/pos/src/features/order-history/OrderHistoryPanel.tsx:72-90` (+ effet refetch) et la section détail (« Remaining », repérée par le label `Remaining`)
- Test: `apps/pos/src/features/order-history/__tests__/history-refetch-on-open.smoke.test.tsx` (create)

Contexte (vérifié SQL + code) : le panel est monté en permanence, `useOrderHistory` (staleTime 10 s) n'est refetché ni à l'ouverture ni par realtime → KPI/liste figés au dernier mount. Et « Remaining » du détail affiche le total brut sur une commande `paid`.

- [ ] **Step 1 : test**

```tsx
  it('refetches the history when the panel opens (P1-3)', async () => {
    const { rerender } = render(<OrderHistoryPanel open={false} onClose={vi.fn()} />, { wrapper });
    const callsBefore = fetchSpy.mock.calls.length;
    rerender(<OrderHistoryPanel open onClose={vi.fn()} />);
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore));
  });
```

(Harness : mocker `@/lib/supabase` comme les smokes order-history existants ; `fetchSpy` = le mock de `.from('orders').select(...)`.)

- [ ] **Step 2 : implémenter le refetch**

```ts
  const history = useOrderHistory();
  // P1-3 : le panel est monté en permanence — sans refetch à l'ouverture, la
  // liste et les KPI restent figés au dernier mount (constaté live : vente
  // tablette absente du shift history).
  useEffect(() => {
    if (open) void history.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
```

- [ ] **Step 3 : fix Remaining**

Localiser le rendu « Remaining » dans la section détail du panel (grep `Remaining` dans `apps/pos/src/features/order-history/`). Remplacer la valeur par :

```ts
  const paidSum = detailOrder.paid_by_method.reduce((s, m) => s + m.amount, 0);
  const remaining = detailOrder.status === 'paid' ? 0 : Math.max(0, detailOrder.total - paidSum);
```

(Adapter aux noms réels du composant détail — si le détail vient de `useOrderDetail`, faire la somme sur ses tenders.)

- [ ] **Step 4 : suites + commit**

Run: `pnpm --filter @breakery/app-pos test order-history`

```bash
git add apps/pos/src/features/order-history
git commit -m "fix(pos): session 43 — wave D — history refetch on open + correct Remaining on paid orders (P1-3)"
```

---

# WAVE E — P2 polish

### Task E1 : confirmation de void local + modal de note hold

**Files:**
- Modify: `apps/pos/src/features/cart/BottomActionBar.tsx` (handler Void local + handler Hold)
- Test: `apps/pos/src/features/cart/__tests__/void-confirm-and-hold-note.smoke.test.tsx` (create)

- [ ] **Step 1 : tests** — (a) tap Void avec panier non-vide → un dialog `role="alertdialog"` apparaît, Confirm vide le panier, Cancel non ; (b) Hold n'appelle plus `window.prompt` (spy `vi.spyOn(window, 'prompt')` → jamais appelé) et ouvre un dialog avec textarea note + bouton Hold.

- [ ] **Step 2 : implémenter** — réutiliser le composant de confirmation du design system s'il existe (grep `AlertDialog\|ConfirmDialog` dans `packages/ui/src/components` ; sinon un `FullScreenModal` minimal avec 2 boutons, pattern `VoidOrderModal` simplifié sans PIN). Pour Hold : remplacer le `window.prompt('Hold note (optional):')` par un state `holdNoteOpen` + petit modal (textarea + Cancel/Hold), le submit appelant le hold mutation existant avec la note.

- [ ] **Step 3 : suites + commit**

Run: `pnpm --filter @breakery/app-pos test cart`

```bash
git add apps/pos/src/features/cart
git commit -m "fix(pos): session 43 — wave E — confirm dialog on local void + proper hold-note modal (P2-1, P2-2)"
```

### Task E2 : labels & a11y — held orders, FullScreenModal, KDS

**Files:**
- Modify: `apps/pos/src/features/cart/HeldOrdersModal.tsx` (label held)
- Modify: `packages/ui/src/components/FullScreenModal.tsx` (prop `accessibleTitle`)
- Modify: `apps/pos/src/features/kds/` — composant ticket (grep `'#' +\|##` pour le double `#`) + `useKdsOrders.ts` (select `orders(order_number, status)`)
- Tests: étendre les smokes existants des 3 zones

- [ ] **Step 1 : held label** — dans `HeldOrdersModal`, remplacer l'affichage `order_number` brut (`HELD-<uuid>`) par : `Held {heure locale} · {table_number ?? 'No table'}` (l'heure depuis `created_at`, le `order_number` complet reste en `title=` pour le support).

- [ ] **Step 2 : FullScreenModal a11y** — ajouter une prop `accessibleTitle?: string` (défaut `'Dialog'`) rendue via le composant DialogTitle/VisuallyHidden déjà utilisé (le heading « Modal » actuel — grep `>Modal<` dans `FullScreenModal.tsx` — devient `{accessibleTitle}`). Passer un titre aux call-sites principaux : PaymentTerminal (`"Payment terminal"`), SuccessModal (`"Payment successful"`), OpenShiftModal (`"Open shift"`), CloseShiftModal (`"Close shift"`), HeldOrdersModal (`"Held orders"`), FloorPlanModal (`"Floor plan"`), ModifierModal (`"Customize product"`).

- [ ] **Step 3 : KDS** — (a) double `#` : le ticket rend `#{order_number}` alors que `order_number` contient déjà `#` → retirer le préfixe au rendu ; (b) badge PAID : ajouter `status` au select des orders dans `useKdsOrders`, exposer `order_status` sur `KdsItemRow`, et rendre un badge `PAID` (token `green`) sur le ticket quand `order_status === 'paid'`.

- [ ] **Step 4 : suites + commit**

Run: `pnpm --filter @breakery/app-pos test kds && pnpm --filter @breakery/app-pos test cart && pnpm --filter @breakery/ui test`

```bash
git add packages/ui/src apps/pos/src/features
git commit -m "fix(pos,ui): session 43 — wave E — held label, accessible dialog titles, KDS ## + PAID badge (P2-3..5)"
```

### Task E3 : défaut take-out, auto-submit PIN open-shift, favicon

**Files:**
- Modify: `apps/pos/src/stores/cartStore.ts:163` (+ tous les resets `order_type: 'dine_in'` du store — grep dans le fichier)
- Modify: `packages/ui/src/components/NumpadVirtual.tsx` (prop `autoSubmitAtMaxLength`)
- Modify: `apps/pos/src/features/shift/OpenShiftModal.tsx:206-215`
- Create: `apps/pos/public/favicon.svg` + Modify: `apps/pos/index.html` (`<link rel="icon" href="/favicon.svg" />`)

- [ ] **Step 1 : défaut take_out** — `cart: { items: [], order_type: 'take_out' }` dans l'état initial ET dans les actions de reset du store (grep `'dine_in'` dans `cartStore.ts`). Mettre à jour les tests du store qui assertent `dine_in` comme défaut (les fixtures de tests qui *définissent* `dine_in` explicitement ne changent pas). **Note PR : D9 — à valider owner.**

- [ ] **Step 2 : auto-submit** — dans `NumpadVirtual` (mode pin), ajouter :

```ts
  /** Auto-submit when the value reaches maxLength (mode 'pin' only). Opt-in. */
  autoSubmitAtMaxLength?: boolean;
```

et dans le handler de saisie de digit, après mise à jour de la valeur : si `autoSubmitAtMaxLength && next.length === maxLength` → `onSubmit(next)`. Câbler `autoSubmitAtMaxLength` dans `OpenShiftModal` (l.206). Test UI : taper 6 digits → `onSubmit` appelé sans cliquer Verify.

- [ ] **Step 3 : favicon** — un SVG « B » sobre (fond `#1a1a1a`, lettre or `#c9a227`, même esprit que le BrandMark) :

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#1a1a1a"/><text x="16" y="22" font-family="Georgia, serif" font-size="18" fill="#c9a227" text-anchor="middle">B</text></svg>
```

- [ ] **Step 4 : suites + commit**

Run: `pnpm --filter @breakery/app-pos test stores && pnpm --filter @breakery/ui test Numpad && pnpm typecheck`

```bash
git add apps/pos/src/stores apps/pos/public apps/pos/index.html packages/ui/src
git commit -m "fix(pos,ui): session 43 — wave E — take_out default, PIN auto-submit on open-shift, favicon (P2-6, P2-10)"
```

### Task E4 : migration `_012` — data fixes images + zones

**Files:**
- Create: `supabase/migrations/20260627000012_data_fix_placeholder_images_and_patio_zone.sql`

- [ ] **Step 1 : compter avant** (via `execute_sql`) :

```sql
SELECT count(*) FROM products WHERE image_url LIKE '%via.placeholder.com%';
SELECT name, sort_order FROM restaurant_tables WHERE name ILIKE 'patio%';
```

- [ ] **Step 2 : migration data-only**

```sql
-- 20260627000012_data_fix_placeholder_images_and_patio_zone.sql
-- S43 Wave E (P2-8, P2-9) — data only, aucun schéma.
-- (a) via.placeholder.com timeout en boucle au POS (console + latence) ;
--     NULL déclenche le fallback BrandMark de ProductCard.
UPDATE products SET image_url = NULL WHERE image_url LIKE '%via.placeholder.com%';
-- (b) Convention FloorPlanModal : sort_order >= 100 = Terrace. Les tables
--     Patio-* du seed étaient < 100 → affichées en Interior, zone Terrace vide.
UPDATE restaurant_tables SET sort_order = 100 + sort_order
  WHERE name ILIKE 'patio%' AND sort_order < 100;
```

Appliquer via MCP `apply_migration`. Pas de types regen (data-only).

- [ ] **Step 3 : vérifier** — re-run des 2 SELECT (0 placeholder ; Patio ≥ 100), et au navigateur : zone Terrace (2) dans le floor plan.

- [ ] **Step 4 : commit**

```bash
git add supabase/migrations/20260627000012*
git commit -m "chore(db): session 43 — wave E — data fix placeholder images + Patio terrace sort_order (P2-8, P2-9)"
```

---

# WAVE F — Validation transverse

### Task F1 : E2E Playwright + sweeps complets

**Files:**
- Create: `tests/e2e/s43-pos-audit-fixes.spec.ts`

- [ ] **Step 1 : E2E (suivre les conventions de `tests/e2e/pos-login-order.spec.ts` + `fixtures/auth.ts` — login partagé, rate-limit 3/min/IP)**

3 scénarios :

```ts
// T1 — Remise encaissable (P0-1) : login → add Americano → discount ligne 10% →
//      PinVerificationModal apparaît → PIN seed → checkout cash Exact →
//      expect(receipt-success) visible. Assert réseau : la réponse
//      process-payment est 200 (page.waitForResponse).
// T2 — Realtime inbox (P0-2) : page A = /pos (login), page B = /tablet (login) ;
//      B crée une commande → SUR A, SANS reload :
//      await expect(pageA.getByTestId('tablet-inbox-button')).toBeEnabled({ timeout: 10_000 });
// T3 — Fire persistant (P0-3) : /pos → add item → Send to Kitchen →
//      page.reload() → en SQL (client service-role du harness E2E si dispo,
//      sinon via l'UI KDS) : l'ordre pending_payment existe ; checkout →
//      receipt-success ; SQL : un seul ordre paid.
```

Écrire les 3 tests complets dans le fichier en réutilisant `loginPOS`. Si l'environnement E2E n'a pas les clés service-role, T3 vérifie via l'UI KDS (`/kds`, le ticket est visible après reload de la page KDS).

- [ ] **Step 2 : run E2E**

Run: `npx playwright test tests/e2e/s43-pos-audit-fixes.spec.ts` (env `E2E_POS_URL=http://localhost:5173`, dev server up)
Expected: 3/3 PASS.

- [ ] **Step 3 : sweeps complets**

```bash
pnpm --filter @breakery/domain test
pnpm --filter @breakery/ui test
pnpm --filter @breakery/app-pos test
pnpm typecheck
```

Expected: verts (hors baseline env-gated S25 connue). Re-run pgTAP `counter_fire.test.sql` via MCP.

- [ ] **Step 4 : commit final + PR**

```bash
git add tests/e2e/s43-pos-audit-fixes.spec.ts
git commit -m "test(e2e): session 43 — wave F — discount, realtime inbox, persistent fire (3/3)"
```

PR `swarm/session-43` → `master`, corps : résumé des 3 P0 + lien spec/plan. Après merge : mettre à jour la section **Active Workplan** de `CLAUDE.md` (Session 43, PR #, migrations `20260627000010..012`, EFs redéployées, déviations éventuelles).

---

## Self-review (fait à l'écriture du plan)

- **Couverture spec :** P0-1 → A3+B1+B2+B3+B4 ; P0-2 → A1+A2 (+critère E2E T2) ; P0-3 → C1+C2+C3 (+T3) ; P1-1 → D1 ; P1-2 → D2 ; P1-3 → D3 ; P1-4 → partiellement via C (acté spec §3 pour le reste) ; P2-1/2 → E1 ; P2-3/4/5 → E2 ; P2-6/10 → E3 ; P2-7 → B2 step 4 ; P2-8/9 → E4 ; favicon → E3.
- **Points de vigilance exécution** (écarts possibles vs hypothèses du plan, à vérifier au moment dit) : nom exact des actions cartStore (C2/C3), shape `VerifyResult` (B1), FK `display_stock` pour l'embed (D1), propriété `accessTokenValue` realtime-js (A1 test 3), CHECK `orders_session_id_required_for_pos` (C1 garde-fous). Chaque task contient l'étape de vérification correspondante.
- **Types cohérents :** `fire_counter_order_v1` retourne JSONB `{order_id, order_number, idempotent_replay}` — consommé tel quel en C2 et C3 ; `is_sellable` défini en D1 step 1 et consommé step 5.
