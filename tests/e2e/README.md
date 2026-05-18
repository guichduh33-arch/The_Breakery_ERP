# E2E Tests — The Breakery ERP

Playwright smoke suite targeting the V3 staging environment.

## Quick start

```bash
# List all tests (no server required):
pnpm test:e2e -- --list

# Run against local dev servers:
E2E_POS_URL=http://localhost:5173 E2E_BO_URL=http://localhost:5174 \
  E2E_PIN_CASHIER=123456 E2E_PIN_ADMIN=123456 \
  pnpm test:e2e

# Interactive UI mode:
pnpm test:e2e:ui
```

## Required environment variables

| Variable | Description |
|----------|-------------|
| `E2E_POS_URL` | Base URL of the POS app (e.g. `https://pos.staging.thebreakery.id`) |
| `E2E_BO_URL` | Base URL of the Backoffice app (e.g. `https://backoffice.staging.thebreakery.id`) |
| `E2E_PIN_CASHIER` | 6-digit PIN for the seed cashier user (SEED_USER_CASHIER = `0000...0002`) |
| `E2E_PIN_ADMIN` | 6-digit PIN for the seed admin/owner user (SEED_USER_OWNER = `0000...0001`) |
| `E2E_KIOSK_JWT` | (optional) Pre-issued kiosk JWT to bypass the pair-device prompt on `/display` |

If `E2E_KIOSK_JWT` is absent the kiosk display test asserts only that the pair-device or loading screen is visible (DEV-S21-1.B.1-04).

## CI — nightly GHA workflow

`.github/workflows/playwright-e2e.yml` runs nightly at 22:00 UTC (05:00 ICT) and on `workflow_dispatch`. It does **not** gate PR merges (avoids first-run selector flake blocking developer flow).

Secrets are set in the repository via:

```bash
gh secret set STAGING_POS_URL     --body "https://pos.staging.thebreakery.id"
gh secret set STAGING_BO_URL      --body "https://backoffice.staging.thebreakery.id"
gh secret set E2E_PIN_CASHIER     --body "123456"
gh secret set E2E_PIN_ADMIN       --body "123456"
gh secret set E2E_KIOSK_JWT       --body "<jwt-from-kiosk-issue-jwt-ef>"
```

See `.github/workflows/STAGING_SETUP.md` for full provisioning steps.

## Test files

| File | Project | What it tests |
|------|---------|---------------|
| `complete-order.spec.ts` | pos | S13 original: cashier PIN login → 3 items → cash → receipt |
| `pos-login-order.spec.ts` | pos | S21: POS login → product card → payment terminal → receipt |
| `opname-finalize.spec.ts` | backoffice | S13 original: opname create → count → finalize |
| `po-receive.spec.ts` | backoffice | S13 original: PO create → receive |
| `bo-admin-pin-reset.spec.ts` | backoffice | S21: BO admin login → user detail → reset PIN → success |
| `kiosk-display-realtime.spec.ts` | backoffice | S21: /display page loads; realtime is soft/informational |

## Adding `data-testid` attributes

All selectors use `data-testid` or ARIA roles (no brittle CSS paths). When adding a new spec:

1. Add `data-testid="<component>-<qualifier>"` to the target DOM element.
2. Prefer component-level testids (`product-card-{id}`, `user-row-{id}`) over page-level ones.
3. Update this README table above.

Key testids as of S21:

| Testid | Component | Notes |
|--------|-----------|-------|
| `login-pin-dot-{i}` | `apps/pos/src/pages/Login.tsx` | PIN dot indicators |
| `login-sign-in-btn` | `apps/pos/src/pages/Login.tsx` | Gold "Sign In" CTA |
| `user-picker-{userId}` | `apps/backoffice/src/features/auth/UserPicker.tsx` | User selection button |
| `product-card-{productId}` | `apps/pos/src/features/products/ProductCard.tsx` | Product tile |
| `cart-actions-bar` | `apps/pos/src/features/cart/CartActionsBar.tsx` | Cart actions row |
| `pay-method-{method}` | `apps/pos/src/features/payment/PaymentTerminal.tsx` | Payment method button |
| `pay-cash-exact` | `apps/pos/src/features/payment/PaymentTerminal.tsx` | Fast-path cash exact CTA |
| `receipt-success` | `apps/pos/src/features/payment/SuccessModal.tsx` | Receipt success modal |
| `user-row-{userId}` | `apps/backoffice/src/features/users/components/UsersTable.tsx` | User table row |
| `user-open-{userId}` | `apps/backoffice/src/features/users/components/UsersTable.tsx` | User "Open" link |
| `reset-pin-button` | `apps/backoffice/src/pages/users/UserDetailPage.tsx` | Reset PIN submit button |
| `pin-reset-success` | `apps/backoffice/src/pages/users/UserDetailPage.tsx` | PIN reset success message |
| `display-loading` | `apps/pos/src/features/display/CustomerDisplayPage.tsx` | Display loading state |
| `display-authenticating` | `apps/pos/src/features/display/CustomerDisplayPage.tsx` | Display auth in-progress state |
| `display-authenticated` | `apps/pos/src/features/display/CustomerDisplayPage.tsx` | Display happy-path wrapper |
| `display-queue-list` | `apps/pos/src/features/display/components/OrderQueueTicker.tsx` | Orders queue list |
| `display-queue-empty` | `apps/pos/src/features/display/components/OrderQueueTicker.tsx` | Empty queue message |

## Known issues and deviations

- **DEV-S21-1.B.1-01** (informational): `pos-login-order.spec.ts` skips cart/payment steps when the catalog is empty.
- **DEV-S21-1.B.1-02** (informational): `bo-admin-pin-reset.spec.ts` uses a 6-digit PIN; UserDetailPage validates 4-8 digits but the EF requires exactly 6 (pre-existing DEV-S19-3.B-01).
- **DEV-S21-1.B.1-03** (informational): realtime broadcast not tested deterministically in `kiosk-display-realtime.spec.ts`.
- **DEV-S21-1.B.1-04** (informational): kiosk test shows pair-prompt when `E2E_KIOSK_JWT` is absent — this is expected behaviour.
- **Windows local install**: `pnpm exec playwright install --with-deps chromium` requires admin rights on Windows due to system-dependency installation. Run from an elevated terminal or skip and rely on the GHA runner (ubuntu-latest) for full Chromium install. `pnpm test:e2e -- --list` works on Windows without a browser install.
