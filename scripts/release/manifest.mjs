import { readFileSync } from 'node:fs';
import { git, isMain, ROOT } from '../agents/lib.mjs';
import { digest, inventory, safePath, writeEvidence } from './bundle-files.mjs';
import { validateProject, validateSha } from './preflight.mjs';

export const BUNDLES = { backoffice: '.vercel/output', pos: 'apps/pos/dist', 'print-bridge': 'apps/print-bridge/dist' };

function proofReferences(proof, sha, projectRef) {
  if (proof === null) return [];
  if (proof.sha !== sha || proof.projectRef !== projectRef || !Array.isArray(proof.proofs))
    throw new Error('Les preuves ne correspondent pas au candidat.');
  return proof.proofs.map(({ workflow, runId, runAttempt = 1, sha: proofSha }) => {
    if (!['ci.yml', 'pgtap-pr.yml'].includes(workflow) || !Number.isSafeInteger(runId) || runId <= 0 ||
        !Number.isSafeInteger(runAttempt) || runAttempt < 1 || proofSha !== sha)
      throw new Error('Référence de preuve invalide.');
    return { workflow, runId, runAttempt, sha: proofSha };
  }).sort((a, b) => a.workflow.localeCompare(b.workflow) || a.runId - b.runId);
}

export function createManifest(root, { component, sha, projectRef, proof = null }) {
  if (!Object.hasOwn(BUNDLES, component)) throw new Error('Composant inconnu.');
  validateSha(sha);
  validateProject(projectRef);
  const lock = readFileSync(safePath(root, 'pnpm-lock.yaml'));
  return {
    schemaVersion: 1, component, sourceSha: sha, projectRef,
    scope: 'bundle-identity-only', lockfile: { path: 'pnpm-lock.yaml', sha256: digest(lock) },
    bundleRoot: BUNDLES[component], proofs: proofReferences(proof, sha, projectRef),
    files: inventory(root, BUNDLES[component]),
  };
}

export function verifyManifest(root, manifest) {
  const expected = createManifest(root, { component: manifest.component, sha: manifest.sourceSha,
    projectRef: manifest.projectRef, proof: { sha: manifest.sourceSha, projectRef: manifest.projectRef, proofs: manifest.proofs } });
  if (JSON.stringify(expected) !== JSON.stringify(manifest)) throw new Error('Manifeste différent du bundle ou du lockfile.');
  return { verified: true, component: manifest.component, files: manifest.files.length };
}

if (isMain(import.meta.url)) {
  try {
    const [component, ...args] = process.argv.slice(2);
    if (!Object.hasOwn(BUNDLES, component) || args.some((arg) => !['--verify', '--with-proof'].includes(arg)) || new Set(args).size !== args.length)
      throw new Error('Usage : node scripts/release/manifest.mjs backoffice|pos|print-bridge [--with-proof|--verify] ; RELEASE_SHA et SUPABASE_PROJECT_REF_PRODUCTION requis pour générer.');
    if (args.includes('--verify')) {
      if (args.length !== 1) throw new Error('--verify ne se combine pas avec --with-proof.');
      const manifest = JSON.parse(readFileSync(safePath(ROOT, `.release-manifests/${component}/release-manifest.json`), 'utf8'));
      if (manifest.component !== component) throw new Error('Composant du manifeste incorrect.');
      console.log(JSON.stringify(verifyManifest(ROOT, manifest)));
    } else {
      if (git(['rev-parse', 'HEAD']) !== process.env.RELEASE_SHA || git(['status', '--porcelain', '--untracked-files=normal']))
        throw new Error('Générer depuis un checkout propre au SHA déclaré ; ne pas attribuer un bundle à un autre code.');
      const proof = args.includes('--with-proof')
        ? JSON.parse(readFileSync(safePath(ROOT, `.release-manifests/${component}/preflight.json`), 'utf8')) : null;
      const manifest = createManifest(ROOT, { component, sha: process.env.RELEASE_SHA,
        projectRef: process.env.SUPABASE_PROJECT_REF_PRODUCTION, proof });
      console.log(writeEvidence(ROOT, component, 'release-manifest.json', manifest));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
