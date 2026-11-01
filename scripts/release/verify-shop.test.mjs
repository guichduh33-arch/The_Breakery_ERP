import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { files, hash, PRODUCTION_REF, regularPath, requireInstallable, verifyInstalled, verifyShop } from './verify-shop.mjs';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(ref = PRODUCTION_REF) {
  const root = mkdtempSync(join(tmpdir(), 'shop-release-')); roots.push(root);
  const payload = { 'payload/apps/pos/dist/index.html': '<script src="assets/main.js"></script>',
    'payload/apps/pos/dist/assets/main.js': `const url='https://${ref}.supabase.co';`,
    'payload/apps/print-bridge/dist/server.js': 'export {};',
    'payload/apps/print-bridge/package.json': '{"type":"module"}',
    'verify-shop.mjs': 'export {};', 'install-shop.ps1': '# installer' };
  for (const [path, text] of Object.entries(payload)) {
    mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text);
  }
  const manifest = { version: 1, installable: false, sha: 'a'.repeat(40), projectRef: PRODUCTION_REF, platform: 'win32-x64',
    files: files(root).map((path) => { const bytes = readFileSync(join(root, path)); return { path, bytes: bytes.length, sha256: hash(bytes) }; }) };
  writeFileSync(join(root, 'release.json'), JSON.stringify(manifest));
  return { root, manifest };
}
test('validates the exact payload and production target', () => {
  const f = fixture(); assert.equal(verifyShop(f.root, 'a'.repeat(40)).projectRef, PRODUCTION_REF);
  assert.throws(() => verifyShop(f.root, 'b'.repeat(40)), /identity/);
});
test('refuses installing a validation archive or one missing exact release proofs', () => {
  const f = fixture(); assert.throws(() => requireInstallable(f.manifest), /cannot be installed/);
  f.manifest.installable = true;
  assert.throws(() => requireInstallable(f.manifest), /release proofs/);
  f.manifest.proofs = ['ci.yml','pgtap-pr.yml'].map((workflow) => ({ workflow, sha: f.manifest.sha, runId: 1, runAttempt: 1 }));
  requireInstallable(f.manifest);
  f.manifest.proofs[0].sha = 'b'.repeat(40);
  assert.throws(() => requireInstallable(f.manifest), /release proofs/);
});
test('rejects dev and mixed targets even with a valid inventory', () => {
  assert.throws(() => verifyShop(fixture('ikcyvlovptebroadgtvd').root), /target/);
});
test('rejects changed assets, extra files and missing bridge runtime', () => {
  const f = fixture(); writeFileSync(join(f.root, 'payload/apps/pos/dist/assets/main.js'), 'tampered');
  assert.throws(() => verifyShop(f.root), /integrity/);
  const g = fixture(); writeFileSync(join(g.root, 'extra'), 'extra'); assert.throws(() => verifyShop(g.root), /inventory/);
  const h = fixture(); rmSync(join(h.root, 'payload/apps/print-bridge/dist/server.js')); assert.throws(() => verifyShop(h.root), /inventory/);
});
test('rejects traversal, Windows path ambiguity and symlinks', () => {
  const f = fixture();
  for (const path of ['../secret', 'C:/secret', 'payload/../secret', 'payload\\secret', '/absolute', 'payload//x']) {
    assert.throws(() => regularPath(f.root, path), /path/);
  }
  symlinkSync(join(f.root, 'release.json'), join(f.root, 'link'));
  assert.throws(() => verifyShop(f.root), /links/);
});
test('rejects case collisions on Windows', () => {
  const f = fixture(); f.manifest.files.push({ ...f.manifest.files[0], path: f.manifest.files[0].path.toUpperCase() });
  writeFileSync(join(f.root, 'release.json'), JSON.stringify(f.manifest)); assert.throws(() => verifyShop(f.root), /inventory/);
});
test('verifies the copied bridge and dependencies before stopping the old service', () => {
  const f = fixture(), destination = mkdtempSync(join(tmpdir(), 'shop-installed-')); roots.push(destination);
  cpSync(join(f.root, 'payload'), destination, { recursive: true });
  verifyInstalled(f.root, destination);
  writeFileSync(join(destination, 'apps/print-bridge/dist/server.js'), 'changed');
  assert.throws(() => verifyInstalled(f.root, destination), /Installed payload/);
});
