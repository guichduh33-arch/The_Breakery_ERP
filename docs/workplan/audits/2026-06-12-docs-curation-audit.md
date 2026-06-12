# Docs Curation Audit — 2026-06-12

> Follow-up to [`2026-06-04-docs-curation-audit.md`](archive/2026-06-04-docs-curation-audit.md) (executed ; archivé par la passe 2 ci-dessous). Scope = drift accumulated S36 → S42 (7 merged sessions + 2 audits in 8 days).

## 1. Summary

The 2026-06-04 curation pass held up well — the root `README.md` is still accurate, no Docker-instruction regression, `CLAUDE.md`'s "Current session" correctly says S42 merged. The rot this time is **moderate and concentrated**:

- **~389 project markdown files** (excluding ~180 vendored claude-flow boilerplate).
- **1 internal contradiction in CLAUDE.md** (migration ledger says `..019`/10 migrations, disk and CLAUDE.md's own stock-audit bullet say `_020`/11) + **4 stale "ready to merge" statuses** (S27/S27c/S28/S29, all merged weeks ago) + **1 mislabeled "Previous session: Session 18"** + **1 duplicate Session-27 block**.
- **A second "ghost session" doc pair**: `2026-05-29-session-34-{spec,plan}` ("POS Critical Fixes") — never executed under that scope; the real S34 became Station Printing. Same pattern as the 05-28 S31/S32 drafts bannered last pass.
- **~61 files eligible for archiving** (S34→S40 triplets, menu-reorg, 7 executed POS-fix pairs, display-stock pair, resolved BO-integrity audit, executed 06-04 curation audit, 17 orphan S13–S25 refs). Keep S41 + S42 + stock-audit + print-bridge-deploy live.
- **Dead links in living files**: 13 `backlog-by-module` files point at a non-existent `docs/workplan/04-modules/` (real: `docs/reference/04-modules/`); 3 workplan files still point at the pre-move `outputs/audit-pos-2026-05-28.md` path.
- Living indexes: `docs/README.md` 8 days stale + wrong module count (18 vs 19); `docs/reference/README.md` "Last verified 2026-05-13"; `CHANGELOG.md` still frozen (known, low).

Headline: fix the CLAUDE.md ledger + statuses first, then the living-file dead links, then archive in batches.

## 2. Current tree map

| Zone | Path | Count | Status |
|---|---|---|---|
| Living context | `CLAUDE.md` | 1 | **stale in spots** (ledger `_020` omission, 4 ready-to-merge ghosts, S18 mislabel, dup S27) |
| Living index | `README.md` (root) | 1 | current ✓ (held since 06-04) |
| Living index | `docs/README.md` | 1 | **stale** (date 06-04, "18 modules" vs real 19) |
| Living index | `docs/reference/README.md` | 1 | mostly current; "Last verified 2026-05-13" stale |
| Living index | `CHANGELOG.md` | 1 | frozen at v0.1.0 (known, low) |
| Canonical reference | `docs/reference/**` | 107 | current ✓ (body-link rot pre-existing, see D) |
| ADR | `docs/adr/` | 1 | current ✓ |
| Workplan specs (live) | `docs/workplan/specs/` | 20 | 1 ghost (05-29 S34), ~13 archive-eligible |
| Workplan plans (live) | `docs/workplan/plans/` | 31 | 1 ghost, ~19 archive-eligible |
| Workplan refs | `docs/workplan/refs/` | 17 | all ≤ S25, all orphaned → archive-eligible |
| Backlog | `docs/workplan/backlog-by-module/` | 27 | living; **13 files have dead module links** |
| Audits (workplan) | `docs/workplan/audits/` | 9 | integral-V3 dir kept (ADR-003); 06-04 curation audit executed → archivable |
| Audits (top) | `docs/audit/` | 3 | BO-integrity **9/9 resolved → archivable**; POS-audit + stock-audit still open → keep |
| Superpowers / runbooks / glossary | — | 4 | current ✓ |
| Archives | `docs/_archive/`, `{specs,plans}/archive/` | 145 | healthy ✓ |
| Junk (untracked, repo root) | `c`, `e.message.includes('Duplicate`, `e.sheet`, `{,`, `{,+`, `���` | 6 | zero-byte shell-redirect debris (today) → delete |

## 3. Findings

### A. Placement & naming

- **A1 🟡 Six zero-byte junk files at repo root** (untracked, created 2026-06-12 17:25–18:10 — botched shell redirects during the S42 session): `c`, `e.message.includes('Duplicate`, `e.sheet`, `{,`, `{,+`, and a mojibake-named `���`. All 0 bytes. *Action: plain delete (untracked, no `git rm` needed). Listed for explicit sign-off per safety contract.*
- **A2 🟡 `.claude/skills/playwright-cli/` is untracked** while the other project skills are versioned (docs-curator was tracked 2026-06-05 "for cross-workstation consistency"). *Not markdown rot per se — surfaced as a question (§4 Q5).*
- **A3 ✓ Naming conventions hold** — all live workplan files follow `YYYY-MM-DD-<scope>-{spec,plan,INDEX}.md`.

### B. Archive candidates (~61 files; keep S41 + S42 + stock-audit + print-bridge-deploy live)

All cross-checked against `git log`: S36 merged via #68 (06-05), S37 #69, S38 #70, S39 #72 (06-11), S40 #73, S41 #74, stock-audit #76/#77, S42 #78 (06-12).

- **B1 🟠 Session triplets S34 → S40 (21 files).** All merged; convention keeps the newest 1–2 sessions live → archive `2026-06-01-session-34-station-printing-{spec,plan,INDEX}`, `2026-05-29-session-35-{spec,plan,INDEX}`, `2026-06-04-session-36-*`, `2026-06-11-session-37-*`, `-38-*`, `-39-*`, `2026-06-12-session-40-*`. Keep **S41** (`2026-06-12-session-41-*` ×3) and **S42** (`-42-catalog-import-minors-{spec,plan}`) and **stock-audit-fixes plan** live. Inbound links: each session's CLAUDE.md "Session N reference" block (rewrite `plans/` → `plans/archive/`, `specs/` → `specs/archive/`); same-directory cross-links between spec/plan/INDEX survive the move unchanged.
- **B2 🟠 Backoffice menu-reorg set (3 files):** `2026-05-27-backoffice-menu-reorg-{spec,plan,addendum-collapsible}` — delivered pre-S33. Inbound: CLAUDE.md "Backoffice menu reorg" bullet (3 links).
- **B3 🟠 POS display-stock isolation pair (2 files):** `2026-05-30-pos-display-stock-isolation-{spec,plan}` — implemented (memory `project_pos_display_stock_isolation`); zero inbound links outside the pair.
- **B4 🟠 7 of the 8 `2026-06-01-pos-*` spec+plan pairs (14 files).** Authored by PR #58, executed by S35a PR #61 (`realtime-channel-uniqueness-fix`, `receipt-payment-method-fix`, `cash-drawer-error-toast`, `paymentterminal-refactor`, `double-print-risk`, `refund-test-investigation`) and S37 Wave D (`claudemd-doc-sync` — PAT-05/06/17/18). **Keep `pos-print-bridge-deploy` live** — bridge deployment is still in the S38+ deferred list. Inbound caveat: `double-print-risk-plan` links to `print-bridge-deploy-plan` (archive→live, needs one `../` rewrite).
- **B5 🟠 `docs/audit/2026-06-01-backoffice-integrity-audit.md` — now fully resolved.** Its own Résolution section says "Critical + High + **9/9 Medium — tous résolus**" (M7 + M9 closed 06-02 via PR #60); the 06-04 pass kept it live only because 2/9 were then open. → `docs/audit/archive/`. Inbound: CLAUDE.md (1 link) + the 06-04 curation audit (moves in the same batch, B6).
- **B6 🟡 `docs/workplan/audits/2026-06-04-docs-curation-audit.md` — executed** (has its §6 execution log; committed as #63). Zero inbound links. → `docs/workplan/audits/archive/`.
- **B7 🟡 17 orphan refs in `docs/workplan/refs/`** — all S13/S14/S24/S25 era, zero inbound links (sessions that consumed them are archived). → `docs/workplan/refs/archive/`.
- **Kept live deliberately:** `docs/workplan/audits/2026-05-20-audit-integral-V3/` + its plan (referenced by immutable ADR-003 — same decision as 06-04); `docs/audit/2026-05-28-pos-audit.md` (findings F-010..013/019..024 still open per CLAUDE.md backlog); `docs/audit/2026-06-12-stock-management-audit.md` (M3 FIFO + m2/m8 open).

### C. Contradictions, duplicates & staleness

- **C1 🟠 CLAUDE.md migration ledger contradicts itself and the disk.** "Migration sequence active" says Stock Audit Fixes "used NAME-block `20260626000010..019` (10 migrations)" — but `supabase/migrations/20260626000020_restore_bev_amer_test_fixture.sql` exists on disk, and the **stock-audit bullet itself** describes "_BEV-AMER restauré par corrective `_020`_". Two paragraphs of the same living file disagree; the ledger is the one future sessions use to pick the next migration number. *Action: ledger → `..010..020` (11 migrations — 6 planifiées + 2 correctives + m4 `_018`/`_019` + corrective `_020`).*
- **C2 🟠 Four stale "✓ ready to merge" session blocks in CLAUDE.md.** S29 ("ready to merge `swarm/session-29`" — merged via PR #37 per the S30 block's own base note), S28 ("`swarm/session-28`" — merged via PR #36 per the S29 base note), S27c ("`swarm/session-27c`" — merged, S28 built on it and master contains its 19-migration block), S27 ("`claude/continue-session-27-5iall`" — merged via PR #30 per the "Session 27 + 27b reference" block one line above). A reader can't tell whether merge work remains. *Action: status-only edits, e.g. "✓ merged via PR #36" (exact S27c PR pinned from its archived INDEX during execution).*
- **C3 🟠 "Previous session: Session 18" mislabel in CLAUDE.md.** Line 47: the rolling label "Previous session" sits on the Session 18 block (merged 2026-05-17, 25 sessions ago) while Current = S42. The 06-04 pass fixed the then-current instance; this is an older fossil further down. *Action: relabel "**Session 18 reference:**".*
- **C4 🟡 Duplicate Session-27 coverage in CLAUDE.md.** "Session 27 + 27b reference" (merged via PR #30) AND a separate "Session 27 reference" ("ready to merge") describe the same work. *Action: keep both bodies (detail differs) but fix the status (C2) and retitle the second "Session 27 detail:" — mirrors the existing "Session 34 reference / Session 34 detail" pattern from the 06-04 dedupe.*
- **C5 🟠 Second "ghost session" doc pair: `2026-05-29-session-34-{spec,plan}` ("Session 34 — POS Critical Fixes").** Never executed under this scope — no INDEX, branch `swarm/session-34` was used by Station Printing instead, and the findings dissolved elsewhere: F-002/F-008 → S36, F-006 PIN-en-body → PR #53, F-004 receipt/drawer → S35/S35a, F-001 Option B draft-order flow → **abandoned** (S35 INDEX records DEV-S35-PLAN-01 "spec's S34 draft-RPC myth"; held orders shipped as Option A instead). Only inbound link: the S35 spec. Same treatment as the 05-28 S31/S32 drafts last pass. *Action: `> ⚠️ SUPERSEDED` banner (with the mapping above) + `git mv` to archive. Mapping to confirm — §4 Q1.*
- **C6 🟡 `docs/README.md` stale again:** "Last updated 2026-06-04" (4 sessions behind) and says "18 modules" twice (lines 16, 22) while `reference/04-modules/` has **19** (01–19 + 02b-orders; `reference/README.md` correctly says 19). *Action: refresh date + count.*
- **C7 🟡 `docs/reference/README.md` "Last verified: 2026-05-13"** — 30 days stale; index content spot-checked accurate. *Action: bump the date (the index itself needs no change).*
- **C8 🟡 `docs/reference/04-modules/00-modules-index.md` frames itself as "Catalogue … d'AppGrav V2" (21 modules)** while sitting as the index of the 19 live V3 module files. A reader landing on the index file gets V2 framing for a V3 authority zone. *Action: one clarifying header line ("V2 specification catalogue conservé pour référence ; l'index V3 vivant = les fichiers 01–19 + 02b de ce dossier") — body untouched.*
- **C9 🟡 `CHANGELOG.md` frozen at v0.1.0 / 2026-05-03** (70 days). Same as 06-04's C7, never actioned. *Action: optional one-line pointer to `docs/workplan/` — §4 Q3.*
- **C10 🟡 S42 has no INDEX** (spec + plan only) and **stock-audit-fixes has no spec** (the audit doc serves as one). Every session S33→S41 has an INDEX; S42's closeout/deviation lives only in CLAUDE.md. Not a contradiction — a process gap surfaced as a question (§4 Q2); docs-curator does not author new docs.

### D. Cross-reference integrity

- **D1 🟠 13 living backlog files link to phantom `docs/workplan/04-modules/*`** — real path is `docs/reference/04-modules/*` (~20 links across `backlog-by-module/01,02,06,07,08,09,11,12,13,16,17,18,20-*.md`). Backlog is living → fix in place.
- **D2 🟠 3 workplan files still point at the pre-move `outputs/audit-pos-2026-05-28.md`:** ghost S34 spec (line 8) + plan (line 13) + `2026-05-29-session-35-spec.md` (line 8). The target was `git mv`'d to `docs/audit/2026-05-28-pos-audit.md` on 06-04; these three escaped the link-fixer. Path-only rewrite (allowed in dated history when *we* moved the target).
- **D3 🟡 `docs/workplan/audits/2026-05-20-audit-integral-V3/00-EXECUTIVE-SUMMARY.md:175`** — mis-nested relative path to `V2_V3_GLOSSARY.md`. Path-only fix.
- **D4 🟡 `docs/DESIGN_POS_AND_BACKOFFICE.md` carries 6 dead links** to never-created `design/*`, `ux/*`, `../DESIGN.md`. Pre-existing rot in a legacy-overlap file; left as-is (matches 06-04 decision) unless the user wants it bannered/archived.
- **D5 ℹ️ Pre-existing reference-doc body rot unchanged** (~270 dead links inside `docs/reference/**` to phantom flow pages, `../DESIGN.md`, `ux/v2-token-inventory.md`, a `breakery-platform/` sibling repo, etc.). Known since 06-04, deliberately untouched — fixing means either creating pages (out of scope) or mass-deleting references from evergreen docs (needs its own decision). Re-reported for visibility only.
- **D6 ✓ CLAUDE.md, root README, docs/README link targets all resolve today.** (CLAUDE.md's S34–S40 links are the ones the archive moves in B1 must rewrite.)

## 4. Proposed action plan (ordered, batched)

1. **🟠 Harmonize CLAUDE.md (C1, C2, C3, C4).** Ledger `..019`→`..020` + `_020` entry; 4× "ready to merge" → merged-with-PR; "Previous session:" → "Session 18 reference:"; second S27 block retitled "Session 27 detail:". *Edits only, no moves.*
2. **🟠 Fix living-file dead links (D1, D3).** 13 backlog files `workplan/04-modules` → `reference/04-modules`; exec-summary glossary path.
3. **🟠 Fix the 3 stale `outputs/` links (D2)** → `docs/audit/2026-05-28-pos-audit.md` (relative form per file).
4. **🟡 Refresh `docs/README.md` (C6) + `docs/reference/README.md` date (C7) + modules-index header line (C8).**
5. **🟠 Banner + archive the ghost S34 pair (C5)** — SUPERSEDED banner with the dissolution mapping, then `git mv` both into `{specs,plans}/archive/`. *Needs Q1 confirmation.*
6. **🟠 Archive session triplets S34→S40 (B1) + menu-reorg (B2) + display-stock (B3) — per-session batches,** rewriting each session's CLAUDE.md links to `archive/` paths; link-check after each batch.
7. **🟠 Archive the 7 executed POS-fix pairs (B4),** keep `print-bridge-deploy` live; rewrite the one archive→live cross-link in `double-print-risk-plan`.
8. **🟠 Archive resolved audits (B5, B6):** BO-integrity → `docs/audit/archive/` (rewrite CLAUDE.md link); 06-04 curation audit → `docs/workplan/audits/archive/`.
9. **🟡 Archive the 17 orphan refs (B7)** → `docs/workplan/refs/archive/`.
10. **🟡 Delete the 6 zero-byte junk files (A1)** — untracked, repo root. *Explicit sign-off required.*
11. **🟡 Optional: CHANGELOG pointer (C9).**

> Safety contract: all moves via `git mv`; dated spec/plan/INDEX bodies never rewritten (banners + path-only link fixes only); the only deletions are the six untracked zero-byte junk files (A1).

## 5. Out of scope / left as-is

- **~180 vendored claude-flow files** + project agents/skills — excluded per doc-map.
- **`docs/workplan/audits/2026-05-20-audit-integral-V3/` + plan** — kept live (ADR-003 references them; ADRs are immutable).
- **`docs/audit/2026-05-28-pos-audit.md` + `2026-06-12-stock-management-audit.md`** — findings still open; live.
- **Reference-doc body rot (D5)** and **`DESIGN_POS_AND_BACKOFFICE.md` (D4)** — pre-existing, needs its own decision; report-only.
- **Backlog content, code, migrations, MEMORY.md** — untouched (MEMORY.md spot-checked: no orphan `[[links]]`; its display-stock memory's file references remain valid after B3 since it cites tables/RPCs, not doc paths).
- **CLAUDE.md leanness** — the Active Workplan is now ~45 lines of very dense session blocks (S13→S42). Condensing S13–S26 blocks to one-liners pointing at their archived INDEXes would cut the file ~40 % but is a bigger rewrite — opt-in, §4 Q4.

---

## 6. Execution log (2026-06-12 — Phase 3, scope approuvé : étapes 1 + 4 + 5 et Q1 confirmée + Q4 condensation)

1. ✅ **CLAUDE.md harmonisé (étape 1 : C1, C2, C3, C4)** — ledger Stock Audit Fixes `..010..019` (10) → `..010..020` (11) avec entrée `_020 restore BEV-AMER` ; 4× « ready to merge » corrigés (S29 → merged PR #37 `d14cf9b`, S28 → PR #36 `66f77d6`, S27c → PR #36 livré dans la PR S28, S27 → PR #30 `8bbb137`) ; « Previous session: » (fossile S18) → « Session 18 reference: » ; doublon « Session 27 reference » → « Session 27 detail » (pattern S34 reference/detail).
2. ✅ **Q4 — condensation S13–S26** : 9 blocs réécrits en one-liners pointant vers les INDEX/specs archivés (S26b, S26, S25, S24, S19, S18, S17, S16, S15 ; S14 était déjà un one-liner). CLAUDE.md : 120 954 → 109 409 octets (−9,5 %). Les bullets « Session N follow-ups » (items encore déférés) conservés intacts.
3. ✅ **Étape 4 (C6, C7, C8)** — `docs/README.md` : date → 2026-06-12, « 18 modules » → 19 (×4 emplacements), range plans « 1-35+ » → « 1-42+, archive/ » ; `docs/reference/README.md` : Last verified → 2026-06-12 (index spot-checké exact) ; `00-modules-index.md` : note V3 ajoutée sous le header (catalogue V2 historique vs index V3 vivant = fichiers numérotés).
4. ✅ **Étape 5 (C5, Q1 mapping confirmé)** — bannières 🗄️ SUPERSEDED (avec la dissolution F-002/F-008→S36, F-006→PR #53, F-004→S35/S35a, F-001 Option B→abandonné « S34 draft-RPC myth ») prépendées aux 2 fichiers fantômes, puis `git mv` vers `{specs,plans}/archive/` ; lien Predecessor de la spec S35 réécrit vers `./archive/`. Link-check post-batch : **0 lien mort** vers les fichiers déplacés, toutes les cibles des one-liners CLAUDE.md résolvent.

**Passe 2 (même jour, étapes 2–3 + 6–11 approuvées) :**

5. ✅ **Étape 2 (D1, D3)** — 15 liens `](../04-modules/...)` → `](../../reference/04-modules/...)` dans 14 fichiers backlog (labels inclus) ; lien glossaire de l'exec-summary integral-V3 corrigé (`docs/V2_V3_GLOSSARY.md` → `../../../V2_V3_GLOSSARY.md`).
6. ✅ **Étape 3 (D2)** — les 3 liens `outputs/audit-pos-2026-05-28.md` repointés vers `docs/audit/2026-05-28-pos-audit.md` (spec S35 + ghost S34 spec/plan archivés).
7. ✅ **Étapes 6–9 (B1–B7)** — **59 fichiers `git mv`** : triplets S34 station-printing → S40 (21), menu-reorg ×3, display-stock ×2, 7 paires `pos-*` (14 — `print-bridge-deploy` gardé live), 17 refs → `refs/archive/`, BO-integrity audit → `docs/audit/archive/`, curation audit 06-04 → `workplan/audits/archive/`. Link-fixer global : **66 liens réécrits dans 31 fichiers** (dont 25 dans CLAUDE.md, le lien archive→live de `double-print-risk-plan`, et des liens d'INDEX déjà archivés vers les refs déplacées). Vérification : **0 lien vers un ancien chemin** ; les 132 liens morts restants en zone vivante = rot pré-existant `docs/reference/` (D5, hors scope acté).
8. ✅ **Étape 10 (A1)** — 6 fichiers junk zéro-octet supprimés + un 7ᵉ apparu en cours de session (`Safety`, 0 octet, même pattern de redirect shell).
9. ✅ **Étape 11 (C9)** — pointeur de fraîcheur ajouté en tête de `CHANGELOG.md` (figé v0.1.0 → renvoi vers `docs/workplan/` + CLAUDE.md).

**Restes ouverts** : Q2 (INDEX S42 manquant — décision process), Q5 (`.claude/skills/playwright-cli/` non tracké), rot pré-existant D5 (~132 liens dans `docs/reference/`) et D4 (`DESIGN_POS_AND_BACKOFFICE.md`).

---

### Questions before Phase 3

1. **Ghost S34 "POS Critical Fixes" (C5):** confirm the dissolution mapping for the SUPERSEDED banner — F-002/F-008→S36, F-006→PR #53, F-004→S35/S35a, F-001 Option B→abandoned (held orders Option A in S35)?
2. **S42 INDEX missing (C10):** intentional for a lightweight session, or do you want one authored (separate task, not curation)?
3. **CHANGELOG (C9):** add the freshness pointer, or leave frozen?
4. **CLAUDE.md condensation (Q4 in §5):** shrink S13–S26 reference blocks to one-liners → archived INDEX links?
5. **`.claude/skills/playwright-cli/` (A2):** track it in git like the other skills, or leave untracked?
