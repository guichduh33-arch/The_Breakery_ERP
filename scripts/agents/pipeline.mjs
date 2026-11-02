import { ROOT, isMain } from './lib.mjs';
import { snapshot } from './delivery-snapshot.mjs';
import { evaluateDelivery, readEvidenceFile } from './delivery-evidence.mjs';
import { githubEvidence } from './delivery-github.mjs';
import { githubReader } from '../release/preflight.mjs';
import { writeDeliveryReport } from './delivery-output.mjs';

export function parseArgs(args) {
  const [mode = 'inspect', ...rest] = args;
  if (!['inspect', 'check'].includes(mode) || rest.length % 2) throw new Error('Usage : pipeline.mjs inspect|check [--base ref] [--target production|dev|none] [--evidence fichier --stage étape] [--output fichier]');
  const options = { mode, base: 'origin/master', target: 'production' };
  const seen = new Set();
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2);
    if (!['--base', '--target', '--evidence', '--stage', '--output'].includes(rest[i]) || seen.has(key) || !rest[i + 1]) throw new Error('Option invalide ou dupliquée.');
    seen.add(key);
    options[key] = rest[i + 1];
  }
  if (mode === 'check' && (!options.evidence || !options.stage)) throw new Error('Fichier de preuves et étape requis.');
  if (mode === 'inspect' && (options.evidence || options.stage)) throw new Error('inspect ne valide aucune preuve.');
  if (!['production', 'dev', 'none'].includes(options.target)) throw new Error('Cible de livraison inconnue.');
  if (options.output && !options.output.replaceAll('\\', '/').startsWith('.release-manifests/delivery/')) throw new Error('Sortie réservée à .release-manifests/delivery/.');
  return options;
}

if (isMain(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const current = snapshot(ROOT, options.base, undefined, options.target);
    const evidence = options.evidence ? JSON.parse(readEvidenceFile(ROOT, options.evidence).toString('utf8')) : null;
    const get = process.env.GITHUB_TOKEN && process.env.GITHUB_REPOSITORY
      ? githubReader(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN) : null;
    const githubResults = options.mode === 'check' ? await githubEvidence(current,
      Array.isArray(evidence?.checks) ? evidence.checks : [], get) : new Map();
    const result = options.mode === 'inspect' ? current : evaluateDelivery(current,
      evidence, options.stage, ROOT, githubResults);
    const json = JSON.stringify(result, null, 2) + '\n';
    if (options.output) writeDeliveryReport(ROOT, options.output, result);
    console.log(json);
    process.exitCode = options.mode === 'check' && !result.valid ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
