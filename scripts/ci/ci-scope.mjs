import { appendFileSync } from 'node:fs';
import { changedPaths } from './db-gate.mjs';
import { git, isMain } from '../agents/lib.mjs';

// Diagnostic seulement : cette classification ne retire aucun contrôle CI.
// Les deux côtés des renommages sont examinés, sans lire les contenus.
export function documentationPath(path) {
  return /^(?:README\.md|AGENTS\.md|CLAUDE\.md|docs\/.+\.md|\.agents\/skills\/.+\.md|\.claude\/(?:skills\/.+\.md|agents\/.+\.md)|\.codex\/agents\/.+\.toml)$/.test(path);
}

export function runtimeScope(eventName, diff) {
  if (!['pull_request', 'push'].includes(eventName)) throw new Error('Événement CI inconnu.');
  const files = changedPaths(diff);
  const documentationOnly = files.length > 0 && files.every(documentationPath) && !/(?:^|\0)T\0/.test(diff);
  return { files, documentationOnly,
    reason: eventName === 'push' ? 'full-master-validation' : documentationOnly ? 'documentation-only' : 'runtime-or-tooling' };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--base')) throw new Error('Usage : ci-scope.mjs [--base ref]');
    const base = args[1] ?? process.env.CI_BASE_SHA;
    if (!base || base.startsWith('-') || /[\s\0]/.test(base)) throw new Error('Base Git explicite requise.');
    const baseSha = git(['rev-parse', '--verify', `${base}^{commit}`]);
    const sourceSha = git(['rev-parse', 'HEAD']);
    const result = { baseSha, sourceSha, ...runtimeScope(process.env.GITHUB_EVENT_NAME ?? 'pull_request',
      git(['diff', '--name-status', '-z', '--find-renames', `${baseSha}...HEAD`, '--'])) };
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `## Validation scope\n\n${result.reason}; ${result.files.length} paths inspected.\n\n`
      + 'Informational classification only. Existing mandatory jobs and application checks remain unchanged.\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
