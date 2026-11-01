// Assemblage depuis le checkout CI propre ; aucune configuration boutique embarquée.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { git, isMain, ROOT } from '../agents/lib.mjs';
import { checkRelease, githubReader } from './preflight.mjs';
import { inventory } from './bundle-files.mjs';
import { files, hash, PRODUCTION_REF, verifyShop } from './verify-shop.mjs';

function resolvePackage(source, name) {
  const require = createRequire(join(source, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    const path = join(directory, name, 'package.json');
    if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).name === name) return dirname(realpathSync(path));
  }
  throw new Error('Runtime dependency cannot be resolved');
}

export function copyRuntime(sourcePackage, destination, ancestors = []) {
  const pkg = JSON.parse(readFileSync(join(sourcePackage, 'package.json'), 'utf8'));
  const identity = `${pkg.name}@${pkg.version}`;
  if (ancestors.includes(identity)) throw new Error('Cyclic runtime dependency requires a reviewed packaging rule');
  mkdirSync(destination, { recursive: true });
  cpSync(sourcePackage, destination, { recursive: true, dereference: true,
    filter: (path) => !path.slice(sourcePackage.length).split(/[\\/]/).includes('node_modules') });
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (name.startsWith('@breakery/')) throw new Error('Workspace dependency must be bundled');
    const current = resolvePackage(sourcePackage, name);
    copyRuntime(current, join(destination, 'node_modules', name), [...ancestors, identity]);
  }
}

export async function packageShop(root, output, proof, validationOnly = false) {
  if (proof.projectRef !== PRODUCTION_REF || git(['rev-parse', 'HEAD']) !== proof.sha
    || git(['status', '--porcelain', '--untracked-files=normal'])) throw new Error('A clean verified production SHA is required');
  if (existsSync(output)) throw new Error('Package destination must be new');
  mkdirSync(output, { recursive: true });
  cpSync(join(root, 'apps/pos/dist'), join(output, 'payload/apps/pos/dist'), { recursive: true, dereference: true });
  const bridge = join(output, 'payload/apps/print-bridge');
  cpSync(join(root, 'apps/print-bridge/dist'), join(bridge, 'dist'), { recursive: true, dereference: true });
  const source = join(root, 'apps/print-bridge');
  const deps = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).dependencies;
  // Le code workspace est inclus par tsup ; les dépendances npm sont copiées avec leur arbre résolu par pnpm.
  for (const name of Object.keys(deps).filter((name) => !name.startsWith('@breakery/'))) {
    const path = resolvePackage(source, name);
    copyRuntime(path, join(bridge, 'node_modules', name));
  }
  writeFileSync(join(bridge, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '22.x' } }));
  writeFileSync(join(bridge, 'dist/release-identity.json'), JSON.stringify({ sha: proof.sha, projectRef: PRODUCTION_REF }));
  for (const name of ['verify-shop.mjs', 'install-shop.ps1', 'Mettre-a-jour.cmd', 'shop-update.example.json']) cpSync(join(root, 'scripts/release', name), join(output, name));
  if (files(output).some((path) => /\.(node|dll|exe)$/i.test(path))) throw new Error('Unreviewed native runtime dependency');
  // Cette garde refuse clés privées, env et tokens service-role dans TOUS les fichiers du paquet.
  const entries = inventory(dirname(output), output);
  const manifest = { version: 1, installable: !validationOnly, sha: proof.sha, projectRef: PRODUCTION_REF, platform: 'win32-x64', node: '22.x',
    lockfileSha256: hash(readFileSync(join(root, 'pnpm-lock.yaml'))), proofs: proof.proofs,
    backendContracts: ['defer_pos_order', 'settle_pos_outstanding', 'close_shift', 'refund-order', 'void-order'],
    files: entries };
  writeFileSync(join(output, 'release.json'), JSON.stringify(manifest, null, 2));
  verifyShop(output, proof.sha);
  return manifest;
}
if (isMain(import.meta.url)) {
  try {
    if (process.env.RELEASE_ENABLED !== 'true' || process.env.RELEASE_APPROVED !== 'true') throw new Error('Protected release approval required');
    const proof = await checkRelease({ sha: process.env.RELEASE_SHA, projectRef: process.env.SUPABASE_PROJECT_REF_PRODUCTION,
      get: githubReader(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN) });
    const result = await packageShop(ROOT, resolve(ROOT, '.release-manifests/shop-package'), proof);
    console.log(JSON.stringify({ sha: result.sha, projectRef: result.projectRef, files: result.files.length }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
