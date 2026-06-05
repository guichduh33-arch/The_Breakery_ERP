# The Breakery — Canonical Doc Map

The taxonomy `docs-curator` uses to classify every markdown file by **function** and judge whether it sits in the right place. Zones are listed by authority: when two docs conflict, the one in the higher-authority zone (or the more recent dated artifact) usually wins. Verify against the live tree before acting — this map describes intent, the repo is ground truth.

## Zone reference

| Zone | Path | Function | Lifecycle | Curation stance |
|---|---|---|---|---|
| **Living context** | `CLAUDE.md`, `MEMORY.md` (in `~/.claude/.../memory/`) | What every session loads first: active workplan, conventions, critical patterns, memory index | **Living** — rewritten continuously | Harmonize against reality. Roll Current→Previous→Reference. Keep lean. |
| **Canonical reference** | `docs/reference/00-overview … 12-appendices` | Evergreen source-of-truth: architecture, DB, design system, per-module specs, security, flows, testing, conventions | Evergreen, kept current | The authority. Other zones reconcile *to* this. Keep numbered structure intact. |
| **ADRs** | `docs/adr/NNN-*.md` | Architecture decisions (e.g. ADR-003 NON-PKP) | Immutable once accepted; superseded only by a newer ADR | Never rewrite. Content contradicting an accepted ADR elsewhere = a finding. |
| **Workplan — specs** | `docs/workplan/specs/YYYY-MM-DD-<scope>-spec.md` | What a session intends to build | **Dated, append-only history** | Never rewrite body. Archive merged+superseded sessions in batches. |
| **Workplan — plans** | `docs/workplan/plans/YYYY-MM-DD-<scope>-{plan,INDEX}.md` | How it's built (plan) + closeout record with deviations (INDEX) | Dated, append-only history | Same as specs. INDEX status field drives archive eligibility. |
| **Workplan — refs / backlog** | `docs/workplan/refs/`, `docs/workplan/backlog-by-module/01..25-*.md` | Reusable refs; living per-module backlog (~280 tasks) | refs: stable · backlog: **living** (edit in place) | Backlog edited in place; don't archive it. |
| **Audits** | `docs/audit/`, `docs/workplan/audits/` | Point-in-time integrity/security audits | Point-in-time | Archive once all findings resolved. New curation audits land in `docs/workplan/audits/`. |
| **Runbooks** | `docs/runbooks/` | Operational how-to | Living | Keep current; flag stale steps. |
| **Superpowers** | `docs/superpowers/{specs,plans}/` | Agent/skill design docs | Dated history | Same append-only treatment as workplan. |
| **Top-level docs** | `docs/README.md`, `docs/V2_V3_GLOSSARY.md` | Index + glossary | Living | README must reflect real tree (Axis D target). |

## Scope boundaries — what is NOT documentation rot

Don't waste the audit on files that aren't part of the project's doc surface:
- **Vendored claude-flow boilerplate** under `.claude/agents/{core,github,sparc,swarm,consensus,…}` and `.claude/commands/` (~180 `.md` files) — third-party tooling, not project docs. Exclude from inventory counts and findings. The **7 named project agents** (`.claude/agents/*.md` top-level) and the **project skills** (`.claude/skills/*/SKILL.md`) ARE project-authored, but they're current and actively maintained (PR #55) — note them, don't curate them unless asked.
- **`MEMORY.md`** lives in `~/.claude/projects/<slug>/memory/`, *outside the repo*. It's already a one-line-per-memory index; read it for cross-ref orphans but it rarely needs restructuring.
- **READMEs inside packages/apps** (`packages/supabase/README.md`, `tests/e2e/README.md`, `.github/workflows/*.md`) — co-located developer docs, leave in place.

## Known legacy / overlap zones (reconcile to canonical reference)

These predate the `docs/reference/` structure and are prime contradiction sources. Treat each file as: does the canonical reference already cover it? If yes → fold unique content in, then banner/archive the legacy file. If no → it may belong *inside* the reference tree (move it there).

- **`docs/objectif travail/`** (note the space in the dir name) — `ACCOUNTING.md`, `B2B.md`, `CASH_REGISTER.md`, `CUSTOMER_DISPLAY.md`, `CUSTOMERS.md`, `EXPENSES.md`, `KDS.md`, `ORDERS.md`, `POS.md`, `PRODUCTION.md`. Almost certainly overlaps `docs/reference/04-modules/`. The space in the directory name is itself a naming flag.
- **`docs/Design/`** (`backoffice/`, `caissapp/`) + **`docs/DESIGN_POS_AND_BACKOFFICE.md`** (root) — overlaps `docs/reference/02-design-system/`. Two design sources of truth = a contradiction risk.
- **Stray root-level `docs/*.md`** beyond README/glossary — evaluate whether they belong in a numbered reference folder.

## Harmonization cross-checks (CLAUDE.md ↔ reality)

Concrete checks for Axis C, with where to verify each claim. Both directions matter: not just "does what the doc claims exist?" but "does the doc account for everything that exists?" — staleness usually hides as *omission*, not as a wrong statement.

| CLAUDE.md / index claims… | Verify against | Failure looks like |
|---|---|---|
| "Current session: Session N" | `git log --oneline --merges` (latest merged PR) | Says S34 ready-to-merge while S35a (#61) already merged |
| "Previous session: …" (should be exactly one) | the rolling convention | **Multiple** "Previous session" lines coexist (the rolling was skipped — there were 3, not 2, in the real file) |
| "Migration `YYYYMMDDHHMMSS` used" / "block `…`" | `git ls-files supabase/migrations/` | Referenced file absent **OR** migrations present on disk (e.g. a whole later-session block) that the "Migration sequence active" paragraph never mentions — completeness, not just existence |
| Links to a spec/plan/INDEX path | file exists at that path | Dead relative link after an archive move |
| "Session N reference" facts | the session's own INDEX §closeout | Two blocks stating different statuses for the same session |
| Critical-pattern claims (RPC versions, REVOKE pairs) | the actual migration/RPC | Pattern doc drifted from code (report only — code is out of scope to change) |

Also check the **other living indexes**, not just CLAUDE.md — they rot the same way:
- **`docs/README.md`** — its "Last updated" date, any "sessions 1-N" range it states (vs the real count), dead external links (`../DESIGN.md`, `../CURRENT_STATE.md`), and any V2/V3 framing that calls the canonical `reference/` tree "V2 / never deployed" while the doc-map treats it as the authority. That framing contradiction confuses new readers about whether reference docs are current.
- **`CHANGELOG.md`** (root) — frozen at the bootstrap version while the project is 30+ sessions on. Low severity (it doesn't claim a wrong *current* state), but worth a freshness pointer.
- **`reference/README.md`** — its index must list the real numbered files (numbers shift over time).

## Authority order for resolving doc-vs-doc conflicts

When two markdown files disagree about the same fact, propose the winner in this order, and route the losers to merge-then-archive or a SUPERSEDED banner:

1. Accepted **ADR** (decisions are binding)
2. Most recent dated **spec/plan/INDEX** (latest intent + closeout)
3. **Canonical reference** (`docs/reference/`)
4. **Legacy zone** docs (lowest — usually the thing to retire)

Always confirm the winner reflects what's actually in the code/migrations before rewriting anything; a recent spec can still be wrong if a later corrective changed course (the INDEX deviations section is where that's recorded).
