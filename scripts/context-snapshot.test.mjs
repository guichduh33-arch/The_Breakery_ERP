import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './agents/lib.mjs';

const run = (cwd, args = ['pos', '--json']) => JSON.parse(execFileSync(process.execPath,
  [join(ROOT, 'scripts/context-snapshot.mjs'), ...args], { cwd, encoding: 'utf8' }));

test('snapshot : mêmes chemins depuis la racine ou un sous-répertoire', () => {
  const root = run(ROOT);
  assert.deepEqual(run(join(ROOT, 'apps/pos')), root);
  assert.ok(root.files.some((file) => file.startsWith('apps/pos/src/')));
  assert.ok(root.files.includes('apps/pos/package.json'));
  assert.ok(root.files.includes('AGENTS.md'));
  assert.equal(root.count, root.files.length);
  assert.ok(root.files.every((file) => !/\/(android|dist|coverage|node_modules|\.turbo)\//.test(file)));
});

test('snapshot : alias BO et filtrage binaire restent disponibles', () => {
  assert.deepEqual(run(ROOT, ['bo', '--json']), run(ROOT, ['backoffice', '--json']));
  const plain = run(ROOT);
  const binary = run(ROOT, ['pos', '--json', '--include-binary']);
  assert.ok(binary.count >= plain.count);
  assert.ok(plain.files.every((file) => binary.files.includes(file)));
});
