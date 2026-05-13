# 04 — iOS Build

> **Last verified**: 2026-05-03

## Status

iOS is **not currently used in production**. The bakery's terminals run on Android tablets and the web app via Vercel. Capacitor's iOS adapter is installed (`@capacitor/ios` 7.5.0) so the iOS target is technically reachable, but:

- There is no `ios:*` script in `package.json` (Android has nine).
- No iOS keystore / provisioning profile is on file.
- No production builds have been pushed to TestFlight / App Store.
- The bakery has no Apple Developer Program enrolment.

This file documents the path **if/when** iOS becomes a target. Treat it as a checklist, not a runbook for an existing deployment.

## Stack (if enabled)

| Component | Version | Notes |
|-----------|---------|-------|
| `@capacitor/ios` | 7.5.0 | Already in `package.json` `dependencies` |
| `@capacitor/cli` | 7.5.0 | Already installed |
| Xcode | 15+ | Required to build for iOS 17 / 18 |
| CocoaPods | 1.15+ | Capacitor 7 requires CocoaPods for native plugin dependency resolution |
| macOS | 14+ (Sonoma) | Xcode 15 minimum host |
| Apple Developer Program | active | $99/year; required for code signing + App Store |

## Initial setup

```bash
# One-time
npx cap add ios

# Capacitor scaffolds an ios/ directory with an Xcode project (App.xcworkspace)
# CocoaPods will run automatically; if it fails, install: sudo gem install cocoapods
```

After this, the repo will contain `ios/App/App.xcworkspace`. Open it in Xcode and configure:

| Xcode setting | Value |
|---------------|-------|
| Signing & Capabilities → Team | Your Apple Developer team |
| Signing & Capabilities → Bundle Identifier | `com.thebreakery.appgrav` (must match `capacitor.config.ts`) |
| Deployment Target | iOS 14.0 (Capacitor 7 minimum) |
| Background Modes | Add "Remote notifications" if push is added later |

## Build flow

The `CAPACITOR_BUILD=true` flag (see `03-android-build.md`) applies identically — Vite must emit relative paths for the WebView's `file://` protocol.

```bash
# 1. Build web with Capacitor flag
CAPACITOR_BUILD=true npm run build

# 2. Sync into iOS native project (copies dist + updates pod dependencies)
npx cap sync ios

# 3. Open Xcode
npx cap open ios

# 4. In Xcode:
#    Select target device or simulator
#    Product → Run (⌘R)  for development
#    Product → Archive    for release builds
```

## Suggested package.json scripts

If iOS becomes a target, add the following to `package.json` for parity with Android (currently absent):

```json
"ios:init":   "npx cap add ios",
"ios:sync":   "CAPACITOR_BUILD=true npm run build && npx cap sync ios",
"ios:copy":   "CAPACITOR_BUILD=true npm run build && npx cap copy ios",
"ios:open":   "npx cap open ios",
"ios:build":  "npm run ios:sync && npx cap open ios",
"ios:live":   "npx cap run ios"
```

The `set X=Y` shell prefix used by the Android scripts is Windows-specific; iOS only builds on macOS, so the `KEY=VAL` POSIX prefix above is correct.

## Capacitor config (no changes needed)

`capacitor.config.ts` already declares:

| Field | Value | Effect on iOS |
|-------|-------|---------------|
| `appId` | `com.thebreakery.appgrav` | iOS Bundle Identifier |
| `appName` | `The Breakery POS` | App display name on home screen |
| `webDir` | `dist` | Source for `npx cap sync ios` |
| `server.androidScheme` | `https` | iOS-only equivalent: WebView serves over `capacitor://` by default — no config needed |
| `plugins.SplashScreen` | dark `#111827`, 2 s | Honoured on iOS |
| `plugins.StatusBar` | dark style, `#111827` | Honoured on iOS |
| `plugins.Keyboard` | resize body, dark | Honoured on iOS |

Add `ios: { ... }` block only if you need iOS-specific overrides (content inset, scheme).

## Provisioning & signing

Required for any device build (sim builds are unsigned):

1. Apple Developer Program → Certificates → create iOS Distribution cert.
2. Identifiers → register `com.thebreakery.appgrav`.
3. Provisioning Profiles → create Distribution profile (for App Store) or Ad Hoc (for sideload to ≤100 devices).
4. Xcode → Settings → Accounts → sign in with Apple ID; download profile.
5. Xcode → Project → Signing & Capabilities → choose team + profile.

For CI (e.g. GitHub Actions with `xcode-cloud` or `fastlane`), use **App Store Connect API keys** instead of Xcode UI signing. Keys live in `~/.appstoreconnect/private_keys/` on the runner.

## TestFlight (internal testing)

```bash
# In Xcode:
Product → Archive
# In the Organizer window that opens:
Distribute App → App Store Connect → Upload
```

Builds appear in TestFlight ~5-15 min after upload. Add testers (max 100 internal, max 10 000 external with review).

## App Store submission

After TestFlight UAT:

1. App Store Connect → My Apps → The Breakery POS → "+ Version".
2. Fill in screenshots (6.5" iPhone + 12.9" iPad), description, keywords, support URL.
3. Submit for review (typical turnaround: 24-48h).
4. Manually release once approved, or auto-release on approval.

App Store review will exercise:
- The PIN-login flow (provide a demo PIN in the review notes).
- The privacy / data-handling disclosures (Sentry sampling, Supabase data residency).
- Crash-free behaviour on a real device.

## Things to watch

| Risk | Detail |
|------|--------|
| WebView storage | iOS WebView's IndexedDB / localStorage are subject to ITP eviction after 7 days of inactivity. Test long-idle scenarios (POS unused for a week) |
| Background limits | iOS aggressively suspends WebViews — Realtime channels disconnect after backgrounding ~30s. The LAN hub/client must reconnect on `appstateChange: active` |
| Status bar overlap | iOS requires safe-area insets — confirm Tailwind safe-area utilities are applied to the POS chrome |
| Keyboard | Some Capacitor `Keyboard` events fire differently on iOS; test the cash-input pad on a real device |
| Print server | iOS forbids cleartext HTTP. The local print server on `:3001` must be HTTPS (self-signed will not work — needs a trusted cert) |

## Cross-references

- Android counterpart: `03-android-build.md`
- Capacitor config: `/home/user/appGrav-v2/capacitor.config.ts`
- Vite + Capacitor build flag logic: `vite.config.ts` lines 20-30
