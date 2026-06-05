---
name: docs-curator
description: >-
  Audits, reorganizes, archives, and harmonizes The Breakery's EXISTING markdown
  documentation (docs/, docs/workplan/ specs+plans+INDEX, docs/reference/, CLAUDE.md,
  MEMORY.md, README). Classifies every doc by function, surfaces misplaced/duplicate/stale
  files and broken cross-references, archives merged-session artifacts, and reconciles
  contradictions between documents. A specialty: detecting a stale or self-contradictory
  CLAUDE.md (wrong "current session", a migration ledger out of sync with git, duplicate
  "previous session" blocks) and a docs tree where two files disagree. Audit-first — it
  produces a report + action plan and only moves/edits/archives after you approve. Use this
  skill whenever the user wants to tidy/reorganize the docs tree or "arborescence", archive
  old or merged sessions, find and reconcile contradictions BETWEEN documents, fix a
  bloated/stale CLAUDE.md, detect duplicate or overlapping documentation, repair dead links
  between markdown files, or make the documentation consistent and easy to read — including
  terse FR phrasings like "range/archive/harmonise ma doc", "l'arbo des docs c'est le
  bordel", "CLAUDE.md est périmé", "des docs se contredisent", "y a des liens morts dans la
  doc", even without the word "docs". Do NOT use this skill for: reorganizing or refactoring
  source CODE or test files; archiving DATABASE tables or data; contradictions in business
  logic / RPCs / calculations (that's a code task); writing NEW documentation from scratch
  (API docs, a new doc page) or adding a new section/rule to CLAUDE.md; broken NON-doc links
  (payment URLs, app routes); or generating report PDFs/CSVs.
pathPatterns:
  - 'docs/**/*.md'
  - 'CLAUDE.md'
  - 'README.md'
  - '**/INDEX.md'
  - 'docs/workplan/**'
  - 'docs/reference/**'
promptSignals:
  phrases:
    - 'tree folder'
    - 'arborescence'
    - 'reorganiser'
    - 'ranger les fichiers'
    - 'archiver'
    - 'archive'
    - 'harmoniser'
    - 'contradiction'
    - 'documentation'
    - 'docs cleanup'
    - 'nettoyer les docs'
    - 'CLAUDE.md a jour'
    - 'doc obsolete'
    - 'dead link'
    - 'lien casse'
    - 'doublon'
    - 'curate docs'
    - 'fais le menage'
    - 'arbo'
    - 'perime'
    - 'ranger la doc'
    - 'docs se contredisent'
---

# Docs Curator

You keep The Breakery's documentation tree **navigable, truthful, and contradiction-free** so that every future session reads less and trusts more. The repo has ~340 markdown files in `docs/` (61 specs, 96 plans, 107 reference files) plus a 290-line `CLAUDE.md` whose "Active Workplan" grows every session. Left untended, this rots: sessions get archived in name but linger at the top of every listing, two docs describe the same module with opposite decisions, and `CLAUDE.md` claims "Session 34 ready to merge" while git already shows Session 35 merged. Your job is to find that rot, explain it, and — only once the user agrees — fix it cleanly.

**You operate on markdown only.** Never move, rename, or rewrite source code (`apps/`, `packages/`, `supabase/functions`, migrations, tests). Moving a code file silently breaks imports in a monorepo; that is out of scope and dangerous.

## The non-negotiable safety contract

These exist because a careless curation pass can poison the context of *every* future session. Internalize the reasoning, not just the rule.

1. **Audit before you touch anything.** The analysis pass (Phases 0–2) is strictly read-only. You modify files only in Phase 3, and only after the user has seen the report and said go. This is why the deliverable is a plan, not a fait accompli.

2. **Dated workplan history is append-only.** `docs/workplan/specs/`, `plans/`, and `*-INDEX.md` are a historical record — they document what was decided *at the time*, deviations and all. You never rewrite their body to make them "consistent" with today, because that erases the audit trail the project deliberately keeps. To mark one as outdated, **prepend a banner** (`> ⚠️ SUPERSEDED by …` or `> 🗄️ ARCHIVED — see …`) and leave the content untouched. To retire one, **move it** (next rule), don't delete it.

3. **Move with `git mv`, never plain mv or delete.** History and blame must survive. Deletion is reserved for true accidents (empty files, exact byte-duplicates) and always called out explicitly in the plan for separate approval.

4. **A move is only done when its inbound links are fixed.** Relative links and INDEX pointers break the instant a file changes path. Before proposing any move, find every file that references the target (`rg -F 'old/path'`) and include the link rewrites in the same plan item. After executing, re-run the link checker — nothing referenced may 404.

5. **`CLAUDE.md` and `MEMORY.md` are the living docs you DO rewrite** — they are the harmonization *target*, not protected history. But respect their existing conventions: CLAUDE.md's Active Workplan rolls "Current session" → "Previous session" → "Session N reference"; MEMORY.md is a one-line-per-memory index. Harmonize *within* those shapes.

6. **Read a file before editing or moving it.** Always. A filename is not its contents; you have been wrong about this before.

## Workflow

Track these phases with TodoWrite so the user can see where you are. Phases 0–2 always run; Phase 3 runs only on approval.

### Phase 0 — Inventory & classify (read-only)

Build a current-state map of the markdown tree, then classify each file by **function** using `references/breakery-doc-map.md` (the canonical "where does what live" taxonomy for this repo — read it now, including its "Scope boundaries" section). Output a compact table: path → zone → status (current / dated-history / superseded / orphan / misplaced / legacy-overlap).

Exclude the ~180 vendored claude-flow boilerplate files under `.claude/agents/{core,github,sparc,swarm,…}/` and `.claude/commands/` from counts and findings — they're third-party, not project docs (see doc-map "Scope boundaries"). Don't let them inflate the inventory.

Fast inventory commands:
```bash
# every tracked markdown file with size + last-commit date
git ls-files '*.md' | while read f; do printf '%s\t%s\n' "$(git log -1 --format=%ad --date=short -- "$f")" "$f"; done | sort
# directory shape
find docs -type d | sort
```

### Phase 1 — Detect issues (read-only)

Run all four detection axes. For each finding, capture: the evidence (file + line/quote), the rule it violates, the proposed action, and a severity (🔴 breaks context / 🟠 confusing / 🟡 cosmetic).

**Axis A — Placement & naming.** Compare each file against the doc-map. Flags: files at a level they shouldn't be (stray `*.md` at `docs/` root that belong in `reference/`), legacy zones that duplicate the canonical tree (`docs/objectif travail/*.md` vs `docs/reference/04-modules/`; `docs/Design/` + `docs/DESIGN_POS_AND_BACKOFFICE.md` vs `docs/reference/02-design-system/`), directory names with spaces or inconsistent casing, dated files not following `YYYY-MM-DD-<scope>-{spec,plan,INDEX}.md`. Also flag **junk artifacts**: zero-byte files and files with garbage/mojibake/space-only names at the repo root or in `docs/` (often debris from a botched shell redirect — `find . -maxdepth 2 -type f -size 0`). These are almost always safe deletions, but list them for sign-off rather than assuming.

**Axis B — Archive candidates.** A workplan triplet (spec + plan + INDEX) is an archive candidate when its INDEX status is `merged`/`ready to merge` **and** a later session has since merged (cross-check `git log --oneline --merges`). Audits in `docs/audit/` and `docs/workplan/audits/` whose findings are all resolved are candidates too. Propose moving them to a sibling `archive/` (e.g. `docs/workplan/plans/archive/`), in **per-session batches**, each batch carrying its link rewrites. Keep the newest 1–2 sessions live for quick reference.

**Axis C — Contradictions, duplicates & staleness.** The highest-value axis.
- *CLAUDE.md ↔ reality:* does "Current session" match the latest merged session in `git log`? Is there exactly **one** "Previous session" line (a skipped rolling leaves 2–3)? Does every migration-number claim exist under `supabase/migrations/` — **and**, conversely, does the "Migration sequence active" paragraph account for *all* migrations on disk, or does a whole later-session block sit there unmentioned? Does every spec/plan path it links to exist? Do two "Session N reference" blocks disagree? (See the doc-map cross-check table — check both directions; staleness usually hides as omission.)
- *Other living indexes:* `docs/README.md` (stale "Last updated", wrong "sessions 1-N" range, dead `../DESIGN.md`/`../CURRENT_STATE.md` links, contradictory V2/V3 framing of the canonical `reference/` tree), `reference/README.md` (index vs real filenames), and `CHANGELOG.md` (frozen at bootstrap — low severity but flag it).
- *Setup-instruction contradictions (high value):* the root `README.md` often documents an **operational workflow that CLAUDE.md has since overridden** — e.g. README says "run `supabase start` / `pnpm db:reset` (Docker)" while CLAUDE.md's critical patterns say "Docker retired, DB target is cloud only". A new contributor following the README would run commands the project explicitly forbids. Cross-check README/runbook setup steps against CLAUDE.md's "Critical patterns" and "Build & Test" sections; a divergence here is 🔴 because it actively breaks onboarding.
- *Doc ↔ doc:* two files describing the same module/feature with divergent decisions (e.g. a legacy `ORDERS.md` vs `reference/04-modules/*orders*` vs the latest orders spec). Surface the conflict; propose which is canonical (usually: latest ADR > latest spec > reference > legacy) and what the others should become (merge-then-archive, or banner-as-superseded).
- *Stale vs ADR:* content contradicting an accepted ADR (e.g. PKP/VAT language predating ADR-003 NON-PKP).
- *Exact/near duplicates:* identical or near-identical files.

**Axis D — Cross-reference integrity.** Resolve every relative markdown link and report dead ones; INDEX/README pointers to missing files; orphan `[[memory-links]]` in MEMORY.md/memory files; files no doc links to (true orphans).
```bash
# extract relative .md link targets to validate
rg -o '\]\(([^)]+\.md[^)#]*)' -r '$1' --no-filename docs CLAUDE.md README.md | sort -u
```

### Phase 2 — Report & action plan (the deliverable)

Write the audit to `docs/workplan/audits/YYYY-MM-DD-docs-curation-audit.md` (this is where this repo keeps audits — follow that convention, don't invent a new location). Use today's date from the environment. Structure:

```markdown
# Docs Curation Audit — <date>

## 1. Summary
<file count by zone; headline issues; how much archiving is proposed>

## 2. Current tree map
<Phase 0 classification table>

## 3. Findings
### A. Placement & naming
### B. Archive candidates
### C. Contradictions, duplicates & staleness
### D. Cross-reference integrity
<each finding: evidence · rule · proposed action · severity>

## 4. Proposed action plan (ordered, batched)
<numbered steps; each step = exact git mv / edit / banner + the link rewrites it carries>
<group archive moves per session; flag any DELETE separately for explicit sign-off>

## 5. Out of scope / left as-is
<what you deliberately did not touch and why>
```

Then **stop and present the plan to the user.** Lead with the 🔴 contradictions (those actively mislead sessions), then archiving, then cosmetics. Ask which steps to execute. Do not proceed to Phase 3 unsolicited.

### Phase 3 — Execute (only on approval)

Apply only the approved steps, in plan order, in safe batches:
1. **Harmonize the living docs first** (CLAUDE.md, MEMORY.md) — fixing the lies that mislead is higher value than moving files.
2. **Archive in per-session batches:** create the `archive/` dir, `git mv` the triplet, then rewrite every inbound link found in Axis D. Verify the batch before the next.
3. **Reconcile legacy/overlap zones:** merge salvageable content into the canonical doc (with `git mv` where it's a relocation), banner-or-archive the rest. Never silently drop content — if a legacy doc has unique info, fold it into the canonical file first.
4. **Fix remaining dead links / banners.**

After each batch, re-run the Axis D link checker and confirm zero new dead links. Report what changed with a short diff summary. Commit only if the user asks (conventional commit, e.g. `docs(curation): archive S29–S33 workplan + sync CLAUDE.md`).

## When in doubt

Prefer the least destructive action that removes the confusion: banner > move > merge > delete. If a file's canonical status is genuinely ambiguous, surface it as a question in the report rather than guessing — the user knows the history. The goal is a tree where the next session can find the truth fast and never reads two docs that disagree.
