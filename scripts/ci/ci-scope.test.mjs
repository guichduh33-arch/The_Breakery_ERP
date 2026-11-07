import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { documentationPath, runtimeScope } from './ci-scope.mjs';

const modified = (path) => `M\0${path}\0`;
test('CI : documentation reconnue, scripts et chemins inconnus classés séparément', () => {
  const docs = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'docs/runbooks/delivery-standard.md',
    '.agents/skills/orders/SKILL.md', '.claude/skills/orders/SKILL.md', '.claude/agents/test-engineer.md', '.codex/agents/test-engineer.toml'];
  assert.ok(docs.every(documentationPath));
  const result = runtimeScope('pull_request', docs.map(modified).join(''));
  assert.equal(result.reason, 'documentation-only');
  assert.equal(result.documentationOnly, true);
  assert.equal('runtimeRequired' in result, false);
  for (const path of ['package.json', 'pnpm-lock.yaml', 'turbo.json', '.github/workflows/ci.yml',
    'scripts/ci/ci-scope.mjs', '.agents/skills/orders/check.mjs', 'apps/backoffice/README.md',
    'packages/ui/README.md', 'docs/example.sql', 'unknown.md']) {
    assert.equal(runtimeScope('pull_request', modified(path)).reason, 'runtime-or-tooling', path);
    assert.equal(runtimeScope('pull_request', modified('AGENTS.md') + modified(path)).reason, 'runtime-or-tooling', path);
  }
});
test('CI : master complet, diff vide prudent, erreurs et types de fichier distingués', () => {
  assert.equal(runtimeScope('push', modified('AGENTS.md')).reason, 'full-master-validation');
  assert.equal(runtimeScope('pull_request', '').reason, 'runtime-or-tooling');
  assert.equal(runtimeScope('pull_request', 'T\0docs/README.md\0').documentationOnly, false);
  for (const diff of ['M\0file', 'R100\0old\0', 'Z\0docs/a.md\0']) assert.throws(() => runtimeScope('pull_request', diff));
  assert.throws(() => runtimeScope('unknown', modified('AGENTS.md')));
});
test('CI : suppressions et deux côtés des déplacements restent couverts, noms non découpés', () => {
  assert.equal(runtimeScope('pull_request', 'R100\0apps/pos/src/a.ts\0docs/a.md\0').documentationOnly, false);
  assert.equal(runtimeScope('pull_request', 'R100\0docs/a.md\0apps/pos/src/a.ts\0').documentationOnly, false);
  assert.equal(runtimeScope('pull_request', 'R100\0docs/a.md\0docs/b.md\0').documentationOnly, true);
  assert.equal(runtimeScope('pull_request', 'D\0apps/pos/src/a.ts\0').documentationOnly, false);
  assert.deepEqual(runtimeScope('pull_request', modified('docs/a space.md')).files, ['docs/a space.md']);
});
test('CI : base absente ou option inconnue ne produit jamais de succès vide', () => {
  const cli = fileURLToPath(new URL('./ci-scope.mjs', import.meta.url));
  for (const args of [[], ['--unknown'], ['--base', '--bad']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8',
      env: { ...process.env, CI_BASE_SHA: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' } });
    assert.ifError(result.error); assert.equal(result.status, 1);
  }
});
test('CI : diagnostic présent sans modifier les contrôles obligatoires', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
  assert.match(workflow, /run: node scripts\/ci\/ci-scope.mjs/);
  assert.doesNotMatch(workflow, /runtime_required/);
  for (const name of ['lint', 'lint-advisory', 'typecheck', 'unit-tests', 'build']) {
    const job = workflow.split(`\n  ${name}:\n`)[1].split(/\n  [a-z][a-z-]*:\n/)[0];
    assert.doesNotMatch(job, /^    if:/m, name);
  }
});
