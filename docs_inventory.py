#!/usr/bin/env python3
"""
docs_inventory.py — Inventaire factuel de la documentation avant reset.

Aucune dépendance externe. Ne modifie RIEN. Produit deux fichiers :
  - docs-inventory.md   : rapport lisible (orphelins, doublons, collisions)
  - docs-triage.csv     : feuille de tri à remplir (colonne PILE)

Usage :
    python3 docs_inventory.py                      # racine = cwd, scanne docs/ + *.md
    python3 docs_inventory.py --root ../the_breakery_ERP --scan docs apps/pos/docs
    python3 docs_inventory.py --stale-days 60 --dup-threshold 0.55

Heuristique de pile (suggestion uniquement, la décision reste humaine) :
    keep-normative : chemin contient decisions/ objectifs/ CLAUDE.md, ou cité par du code
    reference      : chemin contient reference/ generated/ types/ schema  -> régénérable
    archive        : session/ report/ audit/ changelog/ TODO, ou stale + orphelin
    delete?        : orphelin + stale + doublon détecté
"""

from __future__ import annotations

import argparse
import csv
import re
import subprocess
from collections import defaultdict
from datetime import date, datetime
from itertools import combinations
from pathlib import Path

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

EXCLUDE_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", ".turbo", ".venv",
    "__pycache__", "coverage", ".cache", "supabase/.temp",
}
CODE_EXTS = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".sql", ".sh", ".json",
    ".yml", ".yaml", ".toml", ".md", ".mdc",
}
ARCHIVE_HINTS = re.compile(
    r"(session|rapport|report|audit|changelog|todo|notes?|old|legacy|archive|"
    r"brainstorm|draft|wip|_bak|backup|history|journal)", re.I,
)
NORMATIVE_HINTS = re.compile(r"(decision|adr|objectif|goal|spec|invariant|regle|rule|contract)", re.I)
REFERENCE_HINTS = re.compile(r"(reference|generated|gen[-_]|types?|schema|api[-_]doc|autodoc)", re.I)

WORD_RE = re.compile(r"[a-zà-öø-ÿ0-9]+", re.I)
HEADING_RE = re.compile(r"^#{1,3}\s+(.+?)\s*$", re.M)
CODEFENCE_RE = re.compile(r"```.*?```", re.S)
FRONTMATTER_RE = re.compile(r"\A---\n.*?\n---\n", re.S)

# --------------------------------------------------------------------------- #
# Git helpers
# --------------------------------------------------------------------------- #


def git(root: Path, *args: str) -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True, text=True, check=False, timeout=30,
        )
        return out.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def git_meta(root: Path, rel: str) -> dict:
    """Dernière date, nb de commits, nb d'auteurs, date de création."""
    last = git(root, "log", "-1", "--format=%cs", "--", rel)
    first = git(root, "log", "--reverse", "--format=%cs", "--", rel).split("\n")[0]
    count = git(root, "rev-list", "--count", "HEAD", "--", rel)
    authors = git(root, "log", "--format=%an", "--", rel)
    n_auth = len({a for a in authors.split("\n") if a})
    return {
        "last_commit": last or "",
        "first_commit": first if first else "",
        "commits": int(count) if count.isdigit() else 0,
        "authors": n_auth,
    }


def days_since(iso: str) -> int | None:
    if not iso:
        return None
    try:
        d = datetime.strptime(iso, "%Y-%m-%d").date()
    except ValueError:
        return None
    return (date.today() - d).days


# --------------------------------------------------------------------------- #
# Collecte
# --------------------------------------------------------------------------- #


def walk(root: Path, exts: set[str]) -> list[Path]:
    files = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in exts:
            continue
        if any(part in EXCLUDE_DIRS for part in p.relative_to(root).parts):
            continue
        files.append(p)
    return files


def collect_docs(root: Path, scan_dirs: list[str]) -> list[Path]:
    docs: set[Path] = set()
    for d in scan_dirs:
        base = root / d
        if base.is_dir():
            docs.update(walk(base, {".md", ".mdc"}))
        elif base.is_file():
            docs.add(base)
    # .md à la racine + tous les CLAUDE.md / AGENTS.md du repo
    docs.update(p for p in root.glob("*.md"))
    docs.update(
        p for p in walk(root, {".md"})
        if p.name.upper() in {"CLAUDE.MD", "AGENTS.MD", "README.MD"}
    )
    return sorted(docs)


def normalize(text: str) -> list[str]:
    text = FRONTMATTER_RE.sub("", text)
    text = CODEFENCE_RE.sub(" ", text)
    return [w.lower() for w in WORD_RE.findall(text)]


def shingles(words: list[str], n: int = 5) -> set[int]:
    if len(words) < n:
        return {hash(" ".join(words))} if words else set()
    return {hash(" ".join(words[i:i + n])) for i in range(len(words) - n + 1)}


def jaccard(a: set[int], b: set[int]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / (len(a) + len(b) - inter)


# --------------------------------------------------------------------------- #
# Graphe de références
# --------------------------------------------------------------------------- #


def build_refs(root: Path, docs: list[Path]) -> tuple[dict, dict]:
    """Qui cite quel doc. Retourne (refs_by_doc, refs_from_code_by_doc)."""
    by_name: dict[str, list[Path]] = defaultdict(list)
    for d in docs:
        by_name[d.name].append(d)

    refs: dict[Path, set[str]] = {d: set() for d in docs}
    code_refs: dict[Path, set[str]] = {d: set() for d in docs}

    for src in walk(root, CODE_EXTS):
        try:
            text = src.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        is_doc = src.suffix.lower() in {".md", ".mdc"}
        for name, targets in by_name.items():
            if name not in text:
                continue
            for t in targets:
                if t == src:
                    continue
                rel = str(src.relative_to(root))
                refs[t].add(rel)
                if not is_doc:
                    code_refs[t].add(rel)
    return refs, code_refs


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #


def suggest_pile(rel: str, stale: bool, orphan: bool, dup: bool, cited_by_code: bool) -> str:
    low = rel.lower()
    if REFERENCE_HINTS.search(low):
        return "reference (régénérable → supprimer du versionné)"
    if Path(rel).name.upper() in {"CLAUDE.MD", "AGENTS.MD"} or NORMATIVE_HINTS.search(low):
        return "keep-normative"
    if cited_by_code:
        return "keep-normative (cité par le code)"
    if ARCHIVE_HINTS.search(low):
        return "archive"
    if orphan and stale and dup:
        return "delete?"
    if orphan and stale:
        return "archive"
    return "à trancher"


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".", help="racine du repo (défaut: .)")
    ap.add_argument("--scan", nargs="*", default=["docs"], help="dossiers de doc à scanner")
    ap.add_argument("--stale-days", type=int, default=60, help="seuil de péremption (défaut: 60)")
    ap.add_argument("--dup-threshold", type=float, default=0.55, help="seuil Jaccard doublon (défaut: 0.55)")
    ap.add_argument("--out", default=".", help="dossier de sortie des rapports")
    args = ap.parse_args()

    root = Path(args.root).resolve()
    outdir = Path(args.out).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    if not (root / ".git").exists():
        print(f"[!] {root} ne semble pas être un repo git — les dates seront vides.")

    docs = collect_docs(root, args.scan)
    if not docs:
        print("[!] Aucun .md trouvé. Vérifie --root et --scan.")
        return 1
    print(f"[i] {len(docs)} documents trouvés. Analyse en cours…")

    refs, code_refs = build_refs(root, docs)

    rows = []
    sh_cache: dict[Path, set[int]] = {}
    headings: dict[str, list[str]] = defaultdict(list)

    for d in docs:
        rel = str(d.relative_to(root))
        try:
            text = d.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        words = normalize(text)
        sh_cache[d] = shingles(words)

        for h in HEADING_RE.findall(text):
            key = " ".join(normalize(h))
            if len(key) > 8:
                headings[key].append(rel)

        meta = git_meta(root, rel)
        age = days_since(meta["last_commit"])
        title_m = re.search(r"^#\s+(.+)$", text, re.M)
        rows.append({
            "path": rel,
            "title": (title_m.group(1).strip() if title_m else "").replace(";", ","),
            "lines": text.count("\n") + 1,
            "words": len(words),
            "last_commit": meta["last_commit"] or "untracked",
            "age_days": age if age is not None else "",
            "commits": meta["commits"],
            "authors": meta["authors"],
            "refs": len(refs[d]),
            "code_refs": len(code_refs[d]),
            "_doc": d,
        })

    # doublons sémantiques
    dup_pairs = []
    dup_flag: set[str] = set()
    items = [(r["path"], sh_cache[r["_doc"]]) for r in rows if sh_cache[r["_doc"]]]
    for (pa, sa), (pb, sb) in combinations(items, 2):
        score = jaccard(sa, sb)
        if score >= args.dup_threshold:
            dup_pairs.append((score, pa, pb))
            dup_flag.add(pa)
            dup_flag.add(pb)
    dup_pairs.sort(reverse=True)

    # collisions de titres = candidats contradiction
    collisions = {k: v for k, v in headings.items() if len({*v}) > 1}

    for r in rows:
        stale = isinstance(r["age_days"], int) and r["age_days"] > args.stale_days
        orphan = r["refs"] == 0
        r["stale"] = "oui" if stale else "non"
        r["orphan"] = "oui" if orphan else "non"
        r["dup"] = "oui" if r["path"] in dup_flag else "non"
        r["suggestion"] = suggest_pile(r["path"], stale, orphan, r["path"] in dup_flag, r["code_refs"] > 0)
        r["PILE"] = ""  # à remplir par toi

    rows.sort(key=lambda r: (r["suggestion"], -(r["age_days"] or 0)))

    # ---------------- CSV de tri ---------------- #
    csv_path = outdir / "docs-triage.csv"
    cols = ["PILE", "suggestion", "path", "title", "lines", "last_commit", "age_days",
            "commits", "authors", "refs", "code_refs", "orphan", "stale", "dup"]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore", delimiter=";")
        w.writeheader()
        w.writerows(rows)

    # ---------------- Rapport markdown ---------------- #
    md = [
        "# Inventaire documentaire",
        "",
        f"- Racine : `{root}`",
        f"- Généré : {date.today().isoformat()}",
        f"- Documents : **{len(rows)}**",
        f"- Orphelins (cités nulle part) : **{sum(1 for r in rows if r['orphan'] == 'oui')}**",
        f"- Périmés (> {args.stale_days} j) : **{sum(1 for r in rows if r['stale'] == 'oui')}**",
        f"- Impliqués dans un doublon : **{len(dup_flag)}**",
        f"- Lignes totales : **{sum(r['lines'] for r in rows)}**",
        "",
        "## Répartition suggérée",
        "",
        "| Pile suggérée | Fichiers | Lignes |",
        "|---|---:|---:|",
    ]
    agg: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        agg[r["suggestion"]][0] += 1
        agg[r["suggestion"]][1] += r["lines"]
    for k, (n, l) in sorted(agg.items(), key=lambda kv: -kv[1][0]):
        md.append(f"| {k} | {n} | {l} |")

    md += ["", "## Doublons sémantiques (Jaccard ≥ %.2f)" % args.dup_threshold, ""]
    if dup_pairs:
        md += ["| score | A | B |", "|---:|---|---|"]
        md += [f"| {s:.2f} | `{a}` | `{b}` |" for s, a, b in dup_pairs[:60]]
        if len(dup_pairs) > 60:
            md.append(f"\n_… et {len(dup_pairs) - 60} autres paires._")
    else:
        md.append("_Aucun._")

    md += ["", "## Collisions de titres (candidats contradiction)", ""]
    if collisions:
        md += ["| Titre normalisé | Fichiers |", "|---|---|"]
        for k, v in sorted(collisions.items(), key=lambda kv: -len(set(kv[1])))[:40]:
            md.append(f"| {k[:60]} | " + ", ".join(f"`{x}`" for x in sorted(set(v))) + " |")
    else:
        md.append("_Aucune._")

    md += ["", "## Orphelins périmés (candidats suppression)", "",
           "| Fichier | Dernier commit | Âge (j) | Lignes |", "|---|---|---:|---:|"]
    orphans = [r for r in rows if r["orphan"] == "oui" and r["stale"] == "oui"]
    for r in sorted(orphans, key=lambda r: -(r["age_days"] or 0)):
        md.append(f"| `{r['path']}` | {r['last_commit']} | {r['age_days']} | {r['lines']} |")
    if not orphans:
        md.append("| _aucun_ | | | |")

    md += ["", "## Inventaire complet", "",
           "| Fichier | Suggestion | Âge (j) | Réfs | Réfs code | Lignes |", "|---|---|---:|---:|---:|---:|"]
    for r in rows:
        md.append(
            f"| `{r['path']}` | {r['suggestion']} | {r['age_days']} | "
            f"{r['refs']} | {r['code_refs']} | {r['lines']} |"
        )

    md += ["", "---", "",
           "**Étape suivante** : ouvrir `docs-triage.csv`, remplir la colonne `PILE` "
           "(`keep` / `archive` / `delete` / `reference`) pour chaque ligne. "
           "Une seule question par fichier : *contient-il une décision que moi seul pouvais prendre ?* "
           "Si non → il n'est pas `keep`.", ""]

    md_path = outdir / "docs-inventory.md"
    md_path.write_text("\n".join(md), encoding="utf-8")

    print(f"[✓] {md_path}")
    print(f"[✓] {csv_path}")
    print(f"    {len(rows)} docs | {sum(1 for r in rows if r['orphan']=='oui')} orphelins | "
          f"{len(dup_flag)} en doublon | {len(collisions)} collisions de titres")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
