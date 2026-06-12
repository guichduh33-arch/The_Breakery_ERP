# Docs Curation Audit — 2026-06-04

## 1. Summary

The doc tree is **structurally sound but the living indexes have drifted 3 sessions behind reality, and a parallel session-numbering ghost is sitting in the workplan.**

- **364 project markdown files** (excluding ~180 vendored claude-flow boilerplate under `.claude/`).
- Canonical `docs/reference/` (106 files) is clean and well-numbered — the authority holds.
- **6 🔴 contradictions** that actively mislead a new session/contributor (stale CLAUDE.md current-session, skipped "Previous session" roll, README Docker instructions the project forbids, two parallel "Session 31/32" doc sets, an unrecorded migration block, and a V2-framing line in `docs/README.md`).
- **9 dead cross-reference links** across the three index files.
- **2 misplaced/legacy zones** (`outputs/` stray audit, `docs/objectif travail/` legacy module docs).
- **~30 merged-session workplan triplets + 2 resolved audit sets** eligible for archiving (keep S34/S35 live).

Headline: fix the living docs first (CLAUDE.md + README + the two README indexes) — those are the lies every session reads. Archiving is bulk but lower-risk.

## 2. Current tree map

| Zone | Path | Count | Status |
|---|---|---|---|
| Living context | `CLAUDE.md` | 1 | **stale** (current session + ledger drift) |
| Living index | `README.md` (root) | 1 | **stale** (Docker setup contradicts CLAUDE.md) |
| Living index | `docs/README.md` | 1 | **stale** (date, session range, V2 framing, dead links) |
| Living index | `docs/reference/README.md` | 1 | **stale** (4 wrong filenames, 2 dead links) |
| Living index | `CHANGELOG.md` | 1 | frozen at bootstrap (low) |
| Canonical reference | `docs/reference/**` | 106 | current ✓ |
| ADR | `docs/adr/` | 1 | current ✓ |
| Workplan specs | `docs/workplan/specs/` | 61 | dated-history; ~2 superseded dups |
| Workplan plans | `docs/workplan/plans/` | 98 | dated-history; ~2 superseded dups; archive backlog |
| Workplan refs | `docs/workplan/refs/` | 17 | dated-history |
| Backlog | `docs/workplan/backlog-by-module/` | 27 | living (leave in place) |
| Audits | `docs/workplan/audits/2026-05-20-audit-integral-V3/` | 7 | resolved → archive candidate |
| Audit (top) | `docs/audit/2026-06-01-backoffice-integrity-audit.md` | 1 | resolved (#59/#60) → archive candidate |
| Superpowers | `docs/superpowers/{specs,plans}/` | 2 | dated-history ✓ |
| Runbooks | `docs/runbooks/` | 1 | current ✓ |
| Legacy overlap | `docs/objectif travail/` | 16 | misplaced/legacy (space in dir name) |
| Legacy/root | `docs/DESIGN_POS_AND_BACKOFFICE.md` | 1 | overlaps `reference/02-design-system/` (note) |
| Misplaced | `outputs/audit-pos-2026-05-28.md` | 1 | source doc outside docs/, 7 inbound links |
| Images (out of md scope) | `docs/Design/{backoffice,caissapp}/` | 0 .md | naming flag only |

## 3. Findings

### A. Placement & naming

- **A1 🟠 `outputs/audit-pos-2026-05-28.md` lives at repo root, not in `docs/`.** It is the POS audit that spawned sessions 33/34/35 and is **referenced by 7 workplan files**. It belongs in `docs/audit/`. *Rule: top-level stray docs belong in the canonical tree; a move must carry its 7 link rewrites.*
- **A2 🟡 `docs/objectif travail/` (16 module docs, note the space in the dir name).** Legacy "vision business V2" module docs (ACCOUNTING, B2B, ORDERS, POS, PRODUCTION, …) that overlap `docs/reference/04-modules/`. Space in the directory name is itself a naming flag. *Action: reconcile to canonical reference (fold any unique content), then archive; or rename to a hyphenated `docs/legacy-v2-modules/` if kept as reference. Surface for decision — see §4.*
- **A3 🟡 `docs/Design/` image dir has spaces + mojibake filenames** (`Capture d'écran …`, `PO form .jpg`). Image-only (zero markdown) so out of strict md-curation scope; noted for awareness, not actioned.
- **A4 🟡 No junk/zero-byte files found** — tree is clean of shell-redirect debris. ✓

### B. Archive candidates

- **B1 🟠 ~30 merged-session workplan triplets (S1 → S33) are still live at the top of every listing.** Every session ≤ S33 has merged (S33 = PR #49, S34 = #54/#56, S35 = #62 per `git log`). Propose moving spec+plan+INDEX per session into sibling `archive/` dirs (`docs/workplan/specs/archive/`, `docs/workplan/plans/archive/`), **in per-session batches**, keeping **S34 + S35 live**. Each batch rewrites inbound links (mostly CLAUDE.md "Session N reference" pointers — which we keep valid by pointing at the archive path).
- **B2 🟠 `docs/workplan/audits/2026-05-20-audit-integral-V3/` (7 files) — resolved.** Drove the S26 NON-PKP hardening (ADR-003) and subsequent sessions; findings closed. Archive candidate (move to `docs/workplan/audits/archive/`).
- **B3 🟠 `docs/audit/2026-06-01-backoffice-integrity-audit.md` — resolved via #59/#60** ("audit M7 + M9" + "Critical + High + 7/9 Medium"). Archive candidate once you confirm the remaining 2/9 Medium are tracked elsewhere.
- *(This 2026-06-04 audit itself stays live in `docs/workplan/audits/` until its actions are executed.)*

### C. Contradictions, duplicates & staleness  ← highest value

- **C1 🔴 CLAUDE.md "Current session: Session 35 … ✓ ready to merge `swarm/session-35`" is merged.** `git log` shows `0086017 POS Session 35 … (#62)` already on `master`, plus S35a (#61) and BO audits (#59/#60) merged *after* it. A new session reads "ready to merge" and re-does merge work. *Action: roll S35 → "Session 35 reference", set Current session to none/next, capture the post-S35 head.*
- **C2 🔴 "Previous session: none — `master` clean @ `4aa61df` (post-merge S32 PR #40)" contradicts Current = S35.** The rolling convention (Current→Previous→Reference) was skipped — this line is frozen ~3 sessions back (S32) while Current claims S35. *Action: rewrite the Previous-session line to the actual prior session (S35a / S34), or fold into references.*
- **C3 🔴 Root `README.md` Quick Start mandates Docker — which CLAUDE.md explicitly forbids.** README lines 23/32/35/79: "Docker (pour `supabase start`)", `supabase start`, `supabase db reset`, "nécessite supabase start". CLAUDE.md critical pattern: *"DB target is Supabase cloud, NOT local Docker … DO NOT run `pnpm db:reset`, `supabase start`, `supabase db reset` — they require Docker and will fail."* A new contributor following the README runs forbidden, failing commands. *Action: rewrite README "Prerequisites" + "Quick start" to the cloud-MCP workflow; point DB ops at CLAUDE.md's Build & Test section.*
- **C4 🔴 Two parallel "Session 31" and "Session 32" doc sets with different content.**
  - Merged Reports track (canonical): `2026-05-22-session-31-*` (Reports Drill-Down, PR #39) and `2026-05-26-session-32-*` (Reports Vague C, PR #40).
  - Superseded POS renumber drafts: `2026-05-28-session-31-spec/plan` ("POS Critical Fixes") and `2026-05-28-session-32-spec/plan` ("POS Service Polish"). These POS topics were **renumbered into S33/S34/S35** ("POS Service Polish" is the title CLAUDE.md gives **Session 35**). The 05-28 files are orphans (only self/cross-referenced, never linked from CLAUDE.md or an INDEX). *Action: prepend a `> ⚠️ SUPERSEDED — renumbered into S33–S35, see …` banner and archive them. They have **no INDEX** (never executed under these numbers), confirming draft status. Confirm the exact renumber mapping with the user before bannering — see §4.*
- **C5 🟠 Migration ledger omission: `20260619000040..043` on disk, unmentioned in CLAUDE.md.** Disk has `_000040_create_pos_customer_rpcs`, `_000042_create_pos_b2b_debts_rpc`, `_000043_gate_customers_read` — a POS-customer feature block the "Migration sequence active" paragraph never accounts for. Also the Current-session bullet says S35 used "6 migrations `..010..015`" while disk + the ledger paragraph go through `_016` (the `fix_held_rpcs_default_privileges` corrective). *Action: reconcile the ledger — attribute the `..040..043` block to its session and correct `..015`→`..016`. (Report-only on which session; do not touch migrations.)*
- **C6 🟠 `docs/README.md` stale + V2-framing contradiction.** "Last updated 2026-05-20"; tree comment says "plans/ ← sessions 1-12" (now 35); and it frames `docs/reference/` + `docs/objectif travail/` as *"vision business V2 (AppGrav monolithe) — jamais déployée en production"*. The doc-map treats `reference/` as **the current authority** — calling it "V2 never deployed" misleads readers into distrusting current reference docs. *Action: refresh date + session range; clarify that `reference/` is the live V3 source-of-truth (only `objectif travail/` is legacy-V2).*
- **C7 🟡 `CHANGELOG.md` frozen at bootstrap** (2026-05-04, root). Doesn't assert a wrong *current* state; low severity. *Action: add a "see docs/workplan for per-session history" pointer or refresh.*

### D. Cross-reference integrity (9 dead links)

- **D1 🟠 `README.md` → `docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md`** is dead. Actual path: `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md`. *Fix the link target.*
- **D2 🟠 `docs/README.md` → `../DESIGN.md` and `../CURRENT_STATE.md`** — both files do not exist. *Remove or repoint (likely → `DESIGN_POS_AND_BACKOFFICE.md` and the workplan INDEX, respectively).*
- **D3 🟠 `docs/reference/README.md` — 6 dead links:**
  - `00-overview/02-tech-stack.md` → real is `03-tech-stack.md`
  - `00-overview/03-repository-structure.md` → real is `04-repository-structure.md`
  - `00-overview/04-glossary.md` → real is `05-glossary.md`
  - `04-modules/20-users-rbac.md` → no such file (RBAC lives in `01-auth-permissions.md`)
  - `../../DESIGN.md`, `../../CURRENT_STATE.md` → do not exist
  - *Fix: repoint to the real numbered filenames; drop the two missing root links.*
- **D4 🟡 True orphans:** the 05-28 POS session-31/32 set (C4) is reachable only from itself — confirms archive eligibility.

## 4. Proposed action plan (ordered, batched)

Execute top-down; the 🔴 living-doc fixes are highest value and lowest risk.

1. **🔴 Harmonize `CLAUDE.md` Active Workplan (C1, C2, C5).** Roll S35 → "Session 35 reference"; set "Current session" to the true post-S35 head (capture latest `master` commit); rewrite the stale "Previous session: … S32 PR #40" line; reconcile the migration ledger (attribute `20260619000040..043`, fix `..015`→`..016`). *No file moves; edits only.*
2. **🔴 Rewrite root `README.md` setup (C3) + fix its dead link (D1).** Replace Docker/`supabase start`/`db reset` steps with the cloud-MCP workflow (mirror CLAUDE.md Build & Test); repoint the split-2apps-design link.
3. **🔴 Refresh `docs/README.md` (C6) + fix dead links (D2).** Update date/session range; correct the V2-framing line so `reference/` reads as current V3 authority; remove `../DESIGN.md` + `../CURRENT_STATE.md`.
4. **🟠 Fix `docs/reference/README.md` 6 dead links (D3).** Pure link rewrites to real filenames.
5. **🟠 Move `outputs/audit-pos-2026-05-28.md` → `docs/audit/2026-05-28-pos-audit.md` (A1)** via `git mv`, then rewrite the 7 inbound links (5 specs + 2 plans). Re-run link checker.
6. **🔴/🟡 Banner + archive the superseded 05-28 POS session-31/32 set (C4, D4).** Prepend `> ⚠️ SUPERSEDED` banners, then `git mv` the 4 files into `docs/workplan/{specs,plans}/archive/`. **Needs your confirmation of the renumber mapping first** (see question below).
7. **🟠 Archive resolved audits (B2, B3).** `git mv` `2026-05-20-audit-integral-V3/` and `2026-06-01-backoffice-integrity-audit.md` into an `archive/` sibling; rewrite any inbound links.
8. **🟠 Archive merged-session workplan triplets S1→S33 (B1).** Per-session batches into `docs/workplan/{specs,plans,refs}/archive/`; keep S34+S35 live. After each batch, repoint CLAUDE.md "Session N reference" links and re-run the link checker. *Largest task — do last, in approved batches.*
9. **🟡 Reconcile `docs/objectif travail/` (A2)** — decide per the question below.
10. **🟡 `CHANGELOG.md` freshness pointer (C7)** — optional.

> Per the safety contract: every move is `git mv` (history preserved); dated specs/plans/INDEX bodies are **never** rewritten — only banners prepended; no deletions proposed (no junk found).

## 5. Out of scope / left as-is

- **~180 vendored claude-flow files** under `.claude/agents/{core,github,sparc,…}` + `.claude/commands/` — third-party, excluded.
- **7 project agents** (`.claude/agents/*.md`) + **project skills** (`.claude/skills/*/SKILL.md`) — current, actively maintained (PR #55). Not curated.
- **Backlog** `docs/workplan/backlog-by-module/` (27 files) — living, edited in place. Not archived.
- **`docs/Design/` images** — not markdown; naming noted (A3) but not actioned.
- **Code, migrations, RPCs, tests** — never touched by curation; the ledger/migration findings are report-only.
- **`MEMORY.md`** — already a clean one-line index; no orphan `[[links]]` requiring repair surfaced.

---

## 6. Execution log (2026-06-04 — Phase 3, all steps approved)

All four approved scope items executed; `objectif travail/` resolved as **fold + archive**.

1. ✅ **CLAUDE.md harmonized** — S35 rolled current→reference (merged PR #62 `0086017`); new `Current session: none @ 0086017`; stale "Previous session: …S32 PR #40" replaced with the undocumented standalone PRs (#53 security fraud-guard → attributes migrations `20260619000040..043`, #59/#60 BO integrity audit, #57 agents roster); duplicate "Session 34 reference" deduped (→ "Session 34 detail"); S35 migration count `..015`→`..016`.
2. ✅ **README.md** — Docker/`supabase start`/`db reset` Quick Start replaced with the cloud-MCP workflow; dead split-2apps-design link repointed; Scripts + Testing notes corrected.
3. ✅ **docs/README.md + docs/reference/README.md** — dates/session-range refreshed; V2-framing of `reference/` corrected to "canonical V3 authority"; all 9 dead links fixed (00-overview number shifts, phantom module 20, removed `../DESIGN.md` / `../CURRENT_STATE.md`).
4. ✅ **`outputs/audit-pos-2026-05-28.md` → `docs/audit/2026-05-28-pos-audit.md`** (`git mv`); 7 inbound links rewritten.
5. ✅ **Superseded 05-28 POS S31/S32 drafts** — SUPERSEDED banners + `git mv` into `docs/workplan/{specs,plans}/archive/`.
6. ✅ **Merged session triplets S1–S33 + bootstrap archived** — 125 files `git mv`'d into `archive/` (specs: 13 live / 48 archived; plans: 17 live / 81 archived; S34+S35 kept live). All inbound links repaired by a strict basename-fixer scoped to moved files; **0 dead links to any moved file** tree-wide. A first over-reaching link-fix pass (which touched pre-existing rot) was reverted and re-run strictly.
7. ✅ **`docs/objectif travail/` (16 V2 module briefs) → `docs/_archive/objectif-travail-v2/`** — verified section-for-section identical to the `reference/04-modules/*` *Partie I* (the fold already happened 2026-05-13, so no content to re-merge and **no edits to the canonical reference**); each file bannered SUPERSEDED→canonical module; space-in-dirname flag removed; living-doc path mentions (README, glossary, 15 backlog files) updated.
8. ✅ **4 zero-byte junk files** (`$(git`, `Per`, `try`, `{link}` — accidental redirect debris) deleted.

**Not done / deliberately left:** the two resolved-audit archives (B2 `2026-05-20-audit-integral-V3/` is referenced by the **immutable ADR-003**, and B3 backoffice-integrity has **2/9 unresolved medium**) — both kept **live**. Pre-existing reference-doc rot (~270 links to never-created files like `../DESIGN.md`, phantom `08-flows-end-to-end/*` pages, `ux/v2-token-inventory.md`) left untouched — a separate finding, not caused by this curation. Not committed (awaiting user).

---

### One decision needed before Phase 3

**`docs/objectif travail/` (16 legacy V2 module docs):** keep as a renamed reference zone, fold-and-archive into `docs/reference/04-modules/`, or leave untouched? And confirm the C4 renumber mapping (05-28 "POS Critical Fixes" S31 / "POS Service Polish" S32 → which live sessions?) so the SUPERSEDED banners point at the right targets.
