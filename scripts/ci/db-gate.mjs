import { appendFileSync, readFileSync } from 'node:fs';
import { git, isMain, ROOT } from '../agents/lib.mjs';

const DB_PATH = /^(supabase\/(migrations|functions|tests)\/|\.github\/workflows\/pgtap-pr\.yml$|scripts\/ci\/db-gate(?:\.test)?\.mjs$)/;
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? '');

// -z évite les ambiguïtés des noms contenant espaces, tabulations ou retours ligne.
export function changedPaths(diff) {
  if (diff === '') return [];
  const fields = diff.split('\0');
  if (fields.pop() !== '') throw new Error('Diff Git tronqué.');
  const paths = [];
  while (fields.length) {
    const status = fields.shift();
    if (!/^(?:[AMDTUXB]|[RC]\d{1,3})$/.test(status)) throw new Error('Statut Git inconnu.');
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const path = fields.shift();
      if (!path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Chemin Git invalide.');
      paths.push(path);
    }
  }
  return [...new Set(paths)].sort();
}

export function classify({ eventName, event, readDiff }) {
  if (eventName === 'workflow_dispatch') return { applicable: true, reason: 'manual', paths: [] };
  const pr = event?.pull_request;
  if (eventName !== 'pull_request' || !sha(pr?.base?.sha) || !sha(pr?.head?.sha))
    throw new Error('Événement PR et SHA complets requis.');
  const paths = changedPaths(readDiff(pr.base.sha, pr.head.sha)).filter((path) => DB_PATH.test(path));
  return { applicable: paths.length > 0, reason: paths.length ? 'db-changes' : 'not-applicable', paths };
}

export function gate({ classification, applicable, reason, pgtap }) {
  if (classification !== 'success' || !['true', 'false'].includes(applicable))
    throw new Error('Classification absente, annulée ou échouée.');
  if (applicable === 'false' && reason === 'not-applicable' && pgtap === 'skipped')
    return 'DB non applicable : diff complet classifié, aucun test cloud exécuté.';
  if (applicable === 'true' && ['manual', 'db-changes'].includes(reason) && pgtap === 'success')
    return 'DB applicable : pgTAP réellement réussi.';
  throw new Error('Preuve pgTAP manquante, incohérente, ignorée, annulée ou échouée.');
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv[2] === 'classify') {
      const result = classify({ eventName: process.env.GITHUB_EVENT_NAME,
        event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
        readDiff: (base, head) => git(['diff', '--name-status', '-z', '--find-renames', `${base}...${head}`, '--'], ROOT) });
      console.log(JSON.stringify(result));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
        `applicable=${result.applicable}\nreason=${result.reason}\n`);
    } else if (process.argv[2] === 'check') {
      console.log(gate({ classification: process.env.CLASSIFICATION_RESULT,
        applicable: process.env.DB_APPLICABLE, reason: process.env.DB_REASON, pgtap: process.env.PGTAP_RESULT }));
    } else throw new Error('Usage : node scripts/ci/db-gate.mjs classify|check');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
