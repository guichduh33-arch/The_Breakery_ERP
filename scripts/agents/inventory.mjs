import { ROOT, git, isMain } from './lib.mjs';
import { writeDeliveryReport } from './delivery-output.mjs';

export function worktreeEntries(text) {
  return text.split(/\r?\n\r?\n/).filter(Boolean).map((entry) => {
    const lines = entry.split(/\r?\n/);
    const field = (prefix) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
    return { path: field('worktree '), sha: field('HEAD '), branch: field('branch ') ?? null,
      locked: lines.some((line) => line === 'locked' || line.startsWith('locked ')),
      prunable: lines.some((line) => line === 'prunable' || line.startsWith('prunable ')) };
  });
}

export function inventory(root = ROOT, base = 'origin/master', runGit = git) {
  if (!base || base.startsWith('-') || /[\s\0]/.test(base)) throw new Error('Référence de base invalide.');
  const baseSha = runGit(['rev-parse', '--verify', `${base}^{commit}`], root);
  const comparisons = new Map();
  const compare = (sha) => {
    if (comparisons.has(sha)) return comparisons.get(sha);
    try {
      const [behind, ahead] = runGit(['rev-list', '--left-right', '--count', `${baseSha}...${sha}`], root).split(/\s+/).map(Number);
      const unique = ahead ? runGit(['log', '--right-only', '--cherry-pick', '--no-merges', '--format=%H', `${baseSha}...${sha}`], root).split('\n').filter(Boolean) : [];
      const uniqueMerges = ahead ? runGit(['log', '--right-only', '--merges', '--format=%H', `${baseSha}...${sha}`], root).split('\n').filter(Boolean) : [];
      const result = { ahead, behind, patchUniqueCommits: unique, uniqueMerges,
        integration: ahead === 0 ? 'history-integrated' : unique.length === 0 && uniqueMerges.length === 0 ? 'patch-equivalent' : 'needs-content-review' };
      comparisons.set(sha, result);
      return result;
    } catch { return { integration: 'unknown', error: 'Comparaison Git impossible.' }; }
  };
  const trees = worktreeEntries(runGit(['worktree', 'list', '--porcelain'], root)).map((tree) => {
    try {
      const changes = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], tree.path)
        .split('\0').filter(Boolean);
      // Les noms restent dans la preuve privée ; aucun contenu de fichier n’est ouvert.
      return { ...tree, ...compare(tree.sha), changes, dirty: changes.length > 0, accessible: true, cleanupAuthorized: false };
    } catch { return { ...tree, accessible: false, cleanupAuthorized: false,
      error: 'Worktree inaccessible : état et travail local inconnus.' }; }
  });
  const refs = runGit(['for-each-ref', '--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)', 'refs/heads/', 'refs/remotes/origin/'], root)
    .split('\n').filter(Boolean).map((line) => {
      const [ref, sha, committedAt] = line.split('\0');
      return { ref, sha, committedAt, ...compare(sha), worktrees: trees.filter((tree) => tree.branch === ref).map((tree) => tree.path) };
    });
  const stashes = runGit(['stash', 'list', '--format=%gd%x00%H%x00%ci'], root).split('\n').filter(Boolean).map((line) => {
    const [ref, sha, createdAt] = line.split('\0');
    const parents = runGit(['rev-list', '--parents', '-n', '1', sha], root).split(/\s+/).slice(1);
    return { ref, sha, createdAt, trackedPaths: runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', `${sha}^1`, sha, '--'], root).split('\n').filter(Boolean),
      untrackedPaths: parents.length >= 3 ? runGit(['ls-tree', '-r', '--name-only', `${sha}^3`, '--'], root).split('\n').filter(Boolean) : [],
      note: 'Chemins suivis et parent non suivi listés ; aucun contenu réappliqué.' };
  });
  return { schemaVersion: 1, observedAt: new Date().toISOString(), base, baseSha,
    inspectionComplete: trees.every((tree) => tree.accessible),
    summary: { worktrees: trees.length, dirty: trees.filter((tree) => tree.dirty).length,
      inaccessible: trees.filter((tree) => !tree.accessible).length,
      localBranches: refs.filter((ref) => ref.ref.startsWith('refs/heads/')).length, stashes: stashes.length },
    worktrees: trees, refs, stashes,
    limits: ['Lecture locale uniquement : refs origin en cache, aucune lecture GitHub ni fetch automatique.',
      'Équivalence de patch et historique ne prouvent ni livraison ni absence de travail local.',
      'Un commit non équivalent peut avoir été réimplémenté ; comparer le contenu avant de le qualifier de manquant.',
      'Aucune suppression autorisée ou exécutée ; aucun secret ni contenu .env lu.'] };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const options = { base: 'origin/master' };
    const seen = new Set();
    if (args.length % 2) throw new Error('Usage : inventory.mjs [--base ref] [--output .release-manifests/delivery/fichier.json]');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--base', '--output'].includes(args[i]) || seen.has(args[i]) || !args[i + 1]) throw new Error('Option invalide ou dupliquée.');
      seen.add(args[i]); options[args[i].slice(2)] = args[i + 1];
    }
    const report = inventory(ROOT, options.base);
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.output) writeDeliveryReport(ROOT, options.output, report);
    console.log(json);
    process.exitCode = report.inspectionComplete ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
