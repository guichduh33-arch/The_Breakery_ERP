import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { inside } from './lib.mjs';
import { testEvidence } from './test.mjs';
import { STAGES } from './delivery-policy.mjs';

export function readEvidenceFile(root, path) {
  const file = realpathSync(inside(root, path));
  const rel = relative(realpathSync(root), file);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || resolve(rel) === rel) throw new Error('Preuve externe refusée.');
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error('Preuve trop volumineuse.');
  return readFileSync(file);
}
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

export function validateCheck(check, record, root, now = Date.now(), githubResults = new Map()) {
  const notApplicable = record?.status === 'not-applicable';
  if (!record || record.status !== 'passed' && !notApplicable) return 'Preuve réussie absente.';
  if (!nonempty(record.actor) || !nonempty(record.reference)) return 'Acteur et référence requis.';
  const date = Date.parse(record.observedAt);
  if (!Number.isFinite(date) || date > now + 60000) return 'Date de preuve absente ou future.';
  if (record.target !== check.target) return 'Cible de preuve différente de la cible requise.';
  if (notApplicable) return check.allowNotApplicable && nonempty(record.reason)
    ? null : 'Non-applicabilité interdite pour ce contrôle ou justification absente.';
  if (['dev', 'production'].includes(check.target) && !nonempty(record.targetFingerprint)) return 'Identité de l’environnement observé requise.';
  if (check.id === 'database-tests' && (!integer(record.passed) || record.passed === 0 || record.failed !== 0)) return 'Assertions SQL exécutées et sans échec requises.';
  if (check.kind === 'attestation') return null;
  if (check.kind === 'github') return githubResults.has(check.id) ? githubResults.get(check.id) : 'Preuve GitHub non authentifiée.';
  if (record.exitCode !== 0 || !nonempty(record.command)) return 'Commande et code de sortie nul requis.';
  if (!nonempty(record.report) || !/^[a-f0-9]{64}$/.test(record.reportSha256 ?? '')) return 'Rapport et empreinte SHA-256 requis.';
  let bytes;
  try { bytes = readEvidenceFile(root, record.report); } catch { return 'Rapport absent, externe ou illisible.'; }
  if (!bytes.length || createHash('sha256').update(bytes).digest('hex') !== record.reportSha256) return 'Rapport vide ou empreinte différente.';
  if (check.kind === 'vitest') {
    try {
      const result = testEvidence(JSON.parse(bytes.toString('utf8')));
      if (!result.valid || ![result.passed, result.failed, result.skipped].every(integer)) return 'Vitest : aucun test réussi, échec ou rapport invalide.';
      if (result.skipped && !nonempty(record.skipReason)) return 'Tests ignorés à expliquer.';
    } catch { return 'Rapport Vitest invalide.'; }
  }
  if (check.kind === 'node-tap') {
    const report = bytes.toString('utf8');
    const count = (name) => report.match(new RegExp(`^# ${name} ([0-9]+)\\s*$`, 'm'))?.[1];
    if (!(Number(count('pass')) > 0) || count('fail') !== '0' || /^not ok\b/m.test(report)) return 'Rapport Node TAP sans réussite ou avec échec.';
    if (Number(count('skipped') ?? 0) > 0 && !nonempty(record.skipReason)) return 'Tests Node ignorés à expliquer.';
  }
  return null;
}

export function evaluateDelivery(current, evidence, stage, root, githubResults = new Map()) {
  if (!STAGES.includes(stage)) throw new Error('Étape inconnue.');
  const blockers = [];
  if (stage !== 'scoped' && !current.files?.length) blockers.push('Périmètre vide : utiliser le SHA de base du lot figé avant intégration ; aucune preuve métier ne peut être retirée par une base égale à HEAD.');
  if (current.dirty) blockers.push('Checkout sale : committer uniquement le périmètre autorisé avant de rattacher les preuves.');
  if (current.policy.sensitivePaths.length) blockers.push('Fichier potentiellement secret dans le changement : examen requis.');
  if (evidence?.schemaVersion !== 1 || evidence.fingerprint !== current.fingerprint) blockers.push('Preuves absentes ou périmées : SHA, base ou périmètre différent.');
  if (!Array.isArray(evidence?.checks)) blockers.push('Liste des preuves absente.');
  const records = new Map();
  for (const record of Array.isArray(evidence?.checks) ? evidence.checks : []) {
    if (!record || !nonempty(record.id) || records.has(record.id)) { blockers.push('Identifiant de preuve absent ou dupliqué.'); continue; }
    records.set(record.id, record);
  }
  const results = current.policy.checks.filter((check) => STAGES.indexOf(check.stage) <= STAGES.indexOf(stage))
    .map((check) => ({ id: check.id, kind: check.kind, stage: check.stage,
      blocker: validateCheck(check, records.get(check.id), root, Date.now(), githubResults) }));
  for (const result of results) if (result.blocker) blockers.push(`${result.id} : ${result.blocker}`);
  return { schemaVersion: 1, stage, sourceSha: current.sourceSha, fingerprint: current.fingerprint,
    valid: blockers.length === 0, blockers, checks: results,
    limits: ['Contrôle de cohérence des preuves locales, pas une signature de leur auteur ni une certification métier.',
      'Les attestations restent déclaratives ; l’état DB actuel n’est pas inspecté par ce lecteur.',
      'Aucune fusion, migration, publication, installation ou suppression exécutée.'] };
}
