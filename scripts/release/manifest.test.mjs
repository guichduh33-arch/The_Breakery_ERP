import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { BUNDLES, createManifest, verifyManifest } from './manifest.mjs';
import { inventory, safePath, writeEvidence } from './bundle-files.mjs';
import { verifyBuild } from './verify-build.mjs';

const sha = 'a'.repeat(40), projectRef = 'c'.repeat(20);
function fixture(t, component = 'pos') {
  const root = mkdtempSync(join(tmpdir(), 'breakery-manifest-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, content = 'test') => {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content);
  };
  put('pnpm-lock.yaml', 'lockfileVersion: 9');
  const bundle = BUNDLES[component];
  put(`${bundle}/z.js`); put(`${bundle}/index.html`, '<html>test</html>');
  return { root, put, bundle, options: { component, sha, projectRef } };
}
test('manifestes : composants, inventaire trié, empreintes stables et preuve minimale sans extras', (t) => {
  for (const component of Object.keys(BUNDLES)) {
    const { root, put, bundle, options } = fixture(t, component);
    const proof = { sha, projectRef, secret: 'never-copy', proofs: [{ workflow: 'ci.yml', runId: 1, sha, token: 'never-copy' }] };
    const manifest = createManifest(root, { ...options, proof });
    assert.deepEqual(manifest, createManifest(root, { ...options, proof }));
    assert.deepEqual(manifest.files.map((file) => file.path), ['index.html', 'z.js']);
    assert.equal(manifest.scope, 'bundle-identity-only');
    assert.equal(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
    assert.doesNotMatch(JSON.stringify(manifest), /never-copy/);
    assert.equal(verifyManifest(root, manifest).verified, true);
    const path = writeEvidence(root, component, 'release-manifest.json', manifest);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), manifest);
    // Seul le manifeste officiel, hors bundle, est exclu de ses propres empreintes.
    assert.deepEqual(manifest, createManifest(root, { ...options, proof }));
    put(`${bundle}/release-manifest.json`, '{}');
    assert.throws(() => verifyManifest(root, manifest), /Manifeste/);
    assert.ok(createManifest(root, { ...options, proof }).files.some((file) => file.path === 'release-manifest.json'));
  }
});
test('manifestes : altération, ajout, suppression, lockfile et métadonnées modifiés refusés', (t) => {
  for (const mutate of [
    ({ put, bundle }) => put(`${bundle}/z.js`, 'changed'),
    ({ put, bundle }) => put(`${bundle}/new.js`),
    ({ root, bundle }) => rmSync(join(root, bundle, 'z.js')),
    ({ put }) => put('pnpm-lock.yaml', 'different'),
  ]) {
    const f = fixture(t); const manifest = createManifest(f.root, f.options); mutate(f);
    assert.throws(() => verifyManifest(f.root, manifest), /Manifeste/);
  }
  const f = fixture(t), manifest = createManifest(f.root, f.options);
  assert.throws(() => verifyManifest(f.root, { ...manifest, schemaVersion: 2 }), /Manifeste/);
});
test('manifestes : entrées absentes/vides, mauvaises identités et sorties interdites', (t) => {
  const f = fixture(t);
  assert.throws(() => inventory(f.root, 'absent'));
  mkdirSync(join(f.root, 'empty')); assert.throws(() => inventory(f.root, 'empty'), /vide/);
  assert.throws(() => safePath(f.root, '../escape'), /périmètre/);
  assert.throws(() => safePath(f.root, f.root), /périmètre/);
  assert.throws(() => writeEvidence(f.root, '../outside', 'release-manifest.json', {}));
  assert.throws(() => writeEvidence(f.root, 'pos', '../../outside.json', {}));
  for (const options of [{ component: 'unknown' }, { sha: 'short' }, { projectRef: 'ikcyvlovptebroadgtvd' },
    { proof: { sha: 'b'.repeat(40), projectRef, proofs: [] } },
    { proof: { sha, projectRef, proofs: [{ workflow: 'wrong', runId: 1, sha }] } }])
    assert.throws(() => createManifest(f.root, { ...f.options, ...options }));
});
test('manifestes : liens dans le bundle, répertoire racine et ancêtre de sortie refusés', (t) => {
  const f = fixture(t); mkdirSync(join(f.root, 'external'));
  symlinkSync(join(f.root, 'external'), join(f.root, f.bundle, 'linked'), 'junction');
  assert.throws(() => createManifest(f.root, f.options), /symbolique/);
  symlinkSync(join(f.root, 'external'), join(f.root, 'linked-root'), 'junction');
  assert.throws(() => inventory(f.root, 'linked-root'), /symbolique/);
  symlinkSync(join(f.root, 'external'), join(f.root, '.release-manifests'), 'junction');
  assert.throws(() => writeEvidence(f.root, 'pos', 'release-manifest.json', {}), /symbolique/);
});
test('manifestes : fichiers sensibles et secrets connus refusés sans valeur dans les erreurs', (t) => {
  const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString('base64url')}.fake_signature`;
  for (const [file, value] of [['.env.production', 'private-value'], ['key.pem', 'private-value'],
    ['a.js', 'sb_secret_NOT_A_REAL_KEY_123456'], ['a.js', serviceJwt], ['a.js', '-----BEGIN PRIVATE KEY-----']]) {
    const f = fixture(t); f.put(`${f.bundle}/${file}`, value);
    assert.throws(() => createManifest(f.root, f.options), (error) => !error.message.includes(value) && /interdit|Secret/.test(error.message));
  }
});
test('bundle BO : chaque asset compte, même si index.html est identique', (t) => {
  const f = fixture(t, 'backoffice');
  // Un artefact Vercel complet contient sa configuration et son répertoire static.
  f.put('.vercel/output/config.json', '{"version":3}');
  for (const dir of ['apps/backoffice/dist', '.vercel/output/static']) {
    f.put(`${dir}/index.html`, '<html>BO</html>');
    f.put(`${dir}/app.js`, `const url="https://${projectRef}.supabase.co"`);
    f.put(`${dir}/style.css`, 'body{}');
  }
  assert.equal(verifyBuild(f.root, projectRef).verified, true);
  f.put('.vercel/output/static/release-manifest.json', '{}');
  assert.throws(() => verifyBuild(f.root, projectRef), /tous les fichiers/);
  rmSync(join(f.root, '.vercel/output/static/release-manifest.json'));
  f.put('.vercel/output/static/style.css', 'altered');
  assert.throws(() => verifyBuild(f.root, projectRef), /tous les fichiers/);
  f.put('.vercel/output/static/style.css', 'body{}');
  rmSync(join(f.root, '.vercel/output/static/app.js'));
  assert.throws(() => verifyBuild(f.root, projectRef), /tous les fichiers/);
});
