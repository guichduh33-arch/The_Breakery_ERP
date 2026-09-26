import { isMain, ROOT } from '../agents/lib.mjs';
import { writeEvidence } from './bundle-files.mjs';

export const REQUIRED_JOBS = ['governance-guards', 'lint-typecheck-test-build'];
export const REQUIRED_PROTECTION = [...REQUIRED_JOBS, 'db-gate'];
export const REQUIRED_DB_JOBS = ['pgtap', 'db-gate'];
export function validateSha(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('Un SHA Git complet est requis.');
}
export function validateProject(ref) {
  if (!/^[a-z]{20}$/.test(ref ?? '') || ['ikcyvlovptebroadgtvd', 'abjabuniwkqpfsenxljp'].includes(ref)) {
    throw new Error('Une cible V3 production confirmée, distincte de dev et V2, est requise.');
  }
}
export function successfulRun(runs, sha, event, jobs, required = REQUIRED_JOBS) {
  const run = runs.filter((item) => item.head_sha === sha && item.event === event)
    .sort((a, b) => b.id - a.id)[0];
  if (!run || run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Dernier contrôle du SHA absent, incomplet ou échoué.');
  for (const name of required) {
    const job = jobs.find((item) => item.name === name);
    if (!job || job.status !== 'completed' || job.conclusion !== 'success') throw new Error(`Contrôle requis non réussi : ${name}`);
  }
  return run;
}
export function validateProtection(rules, environment) {
  if (!rules.some((rule) => rule.type === 'pull_request')) throw new Error('master doit exiger une PR.');
  const contexts = rules.filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? []).map((check) => check.context);
  if (REQUIRED_PROTECTION.some((name) => !contexts.includes(name))) throw new Error('Contrôles obligatoires absents des règles effectives de master.');
  if (!environment.protection_rules?.some((rule) => rule.type === 'required_reviewers' && rule.reviewers?.length)) {
    throw new Error('Un approbateur doit protéger l’environnement Production.');
  }
}

// GET uniquement ; ni déclenchement de test connecté ni modification GitHub.
export function githubReader(repo, token) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) throw new Error('Dépôt et jeton GitHub requis.');
  return async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Lecture GitHub refusée (${response.status}) : ${path.split('?')[0]}`);
    return response.json();
  };
}
async function pages(get, path, field = null) {
  const values = [];
  for (let page = 1; page <= 100; page++) {
    const data = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = field ? data[field] : data;
    if (!Array.isArray(batch)) throw new Error('Réponse GitHub inattendue.');
    values.push(...batch);
    if (batch.length < 100) return values;
  }
  throw new Error('Pagination non terminée ; validation refusée.');
}
async function workflowProof(get, file, sha, events, required) {
  const runs = await pages(get, `actions/workflows/${file}/runs?head_sha=${sha}`, 'workflow_runs');
  const run = runs.filter((item) => item.head_sha === sha && events.includes(item.event))
    .sort((a, b) => b.id - a.id)[0];
  if (!run) throw new Error(`Preuve absente : ${file}`);
  const jobs = await pages(get, `actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  successfulRun([run], sha, run.event, jobs, required);
  return { runId: run.id, runAttempt: run.run_attempt ?? 1, sha, workflow: file };
}
export async function checkRelease({ sha, projectRef, get }) {
  validateSha(sha);
  validateProject(projectRef);
  const branch = await get('branches/master');
  if (branch.commit?.sha !== sha) throw new Error('Le SHA demandé doit être la tête actuelle de master.');
  validateProtection(await pages(get, 'rules/branches/master'), await get('environments/Production'));
  const proofs = [await workflowProof(get, 'ci.yml', sha, ['push'], REQUIRED_JOBS)];
  const prs = await pages(get, `commits/${sha}/pulls`);
  const pr = prs.find((item) => item.merged_at && item.base?.ref === 'master' && item.merge_commit_sha === sha);
  if (!pr) throw new Error('Aucune PR fusionnée identifiée pour ce SHA.');
  // La dernière PR ne couvre pas toutes les modifications depuis la publication précédente.
  // Exiger une preuve du candidat complet, sans déclencher de tests cloud ici.
  proofs.push(await workflowProof(get, 'pgtap-pr.yml', sha, ['workflow_dispatch'], REQUIRED_DB_JOBS));
  return { sha, projectRef, pr: pr.number, proofs, scope: 'BO uniquement ; ne certifie pas le schéma prod ni le matériel boutique.' };
}
if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== '--save-proof')) throw new Error('Seule option admise : --save-proof.');
    if (process.env.RELEASE_ENABLED !== 'true' || process.env.RELEASE_APPROVED !== 'true') {
      throw new Error('Activation de release et confirmation manuelle requises.');
    }
    const result = await checkRelease({ sha: process.env.RELEASE_SHA, projectRef: process.env.SUPABASE_PROJECT_REF_PRODUCTION,
      get: githubReader(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN) });
    console.log(JSON.stringify(result, null, 2));
    if (args.includes('--save-proof')) writeEvidence(ROOT, 'backoffice', 'preflight.json', result);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
