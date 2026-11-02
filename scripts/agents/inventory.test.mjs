import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventory, worktreeEntries } from './inventory.mjs';

test('inventaire : dirty fusionné préservé, worktree inaccessible inconnu, refs en cache et stash visibles', () => {
  const calls = [];
  const runGit = (args, cwd) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return 'base';
    if (args[0] === 'worktree') return 'worktree clean\nHEAD base\nbranch refs/heads/master\n\nworktree dirty\nHEAD equivalent\nbranch refs/heads/old\n\nworktree missing\nHEAD unknown\nprunable missing\n';
    if (args[0] === 'status') { if (cwd === 'missing') throw new Error('denied'); return cwd === 'dirty' ? '?? unsaved.ts\0' : ''; }
    if (args[0] === 'rev-list') return args.includes('--parents') ? 'stash-sha p1 p2 p3' : args[3].endsWith('equivalent') ? '3\t1' : '0\t0';
    if (args[0] === 'log') return '';
    if (args[0] === 'for-each-ref') return 'refs/heads/master\0base\0date\nrefs/heads/old\0equivalent\0date\nrefs/remotes/origin/stale\0base\0date';
    if (args[0] === 'stash') return 'stash@{0}\0stash-sha\0date';
    if (args[0] === 'diff-tree') return 'packages/domain/src/order.ts';
    if (args[0] === 'ls-tree') return 'packages/domain/src/order.test.ts';
    throw new Error(`Unexpected ${args}`);
  };
  const result = inventory('fixture', 'origin/master', runGit);
  assert.equal(result.inspectionComplete, false);
  assert.equal(result.summary.dirty, 1);
  assert.equal(result.summary.inaccessible, 1);
  assert.equal(result.summary.localBranches, 2);
  assert.equal(result.worktrees[1].integration, 'patch-equivalent');
  assert.equal(result.worktrees[1].cleanupAuthorized, false);
  assert.equal(result.worktrees[2].dirty, undefined);
  assert.equal(result.stashes[0].sha, 'stash-sha');
  assert.deepEqual(result.stashes[0].untrackedPaths, ['packages/domain/src/order.test.ts']);
  assert.equal(calls.some((args) => ['fetch', 'push', 'clean', 'checkout', 'reset', 'remove'].includes(args[0])), false);
});

test('worktrees détachés et verrouillés : aucun nom de branche inventé', () => {
  const [tree] = worktreeEntries('worktree C:/My Folder\nHEAD abc\ndetached\nlocked reason\n');
  assert.equal(tree.path, 'C:/My Folder');
  assert.equal(tree.branch, null);
  assert.equal(tree.locked, true);
  assert.throws(() => inventory('.', '--force', () => ''), /invalide/);
});
