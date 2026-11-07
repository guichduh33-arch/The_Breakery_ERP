import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { git, isMain, ROOT } from '../agents/lib.mjs';

const require = createRequire(import.meta.url);
export const LANES = ['backoffice', 'pos', 'shared'];
const surface = (pkg) => pkg === '@breakery/app-backoffice' ? 'backoffice'
  : pkg === '@breakery/app-pos' ? 'pos' : 'shared';
const ciPath = (path) => /^(?:\.github\/(?:workflows\/ci\.yml$|actions\/ci-setup\/)|scripts\/ci\/ci-)/.test(path);

export function testScope(event, base, changed = []) {
  if (!['push', 'pull_request'].includes(event)) throw new Error('Événement CI inconnu.');
  if (event === 'pull_request' && !/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('SHA de base complet requis.');
  const force = event === 'pull_request' && changed.some(ciPath);
  return { full: event === 'push' || force, force,
    filter: event === 'pull_request' && !force ? [`--filter=...[${base}]`] : [] };
}

export function testTasks(plan, lane, full = false) {
  if (!LANES.includes(lane) || !Array.isArray(plan?.tasks)) throw new Error('Plan Turbo ou voie invalide.');
  const tasks = [];
  const seen = new Set();
  for (const task of plan.tasks) {
    if (task.task !== 'test') continue;
    if (!/^@[a-z0-9-]+\/[a-z0-9-]+$/.test(task.package ?? '') ||
        task.taskId !== `${task.package}#test` || typeof task.command !== 'string' || !task.command || seen.has(task.taskId)) {
      throw new Error('Tâche de test Turbo invalide ou dupliquée.');
    }
    seen.add(task.taskId);
    // Turbo inclut aussi les packages sans script test dans son dry-run.
    if (task.command !== '<NONEXISTENT>') tasks.push(task);
  }
  if (full && !['@breakery/app-backoffice', '@breakery/app-pos'].every((pkg) => tasks.some((task) => task.package === pkg))) {
    throw new Error('Suite complète privée des tests BO ou POS.');
  }
  return tasks.filter((task) => surface(task.package) === lane).map((task) => task.taskId).sort();
}

export function runLane({ lane, scope, turbo, summarize = () => {} }) {
  const plan = JSON.parse(turbo(['run', 'test', '--dry=json', ...scope.filter], true));
  const tasks = testTasks(plan, lane, scope.full);
  const args = ['run', ...tasks, '--continue=dependencies-successful', ...(scope.force ? ['--force'] : [])];
  summarize(tasks.length ? `Command: \`pnpm exec turbo ${args.join(' ')}\``
    : 'No affected test package in this lane; the complete Turbo selection was inspected.');
  if (!tasks.length) return 0;
  const status = turbo(args, false);
  if (!Number.isInteger(status) || status < 0) throw new Error('Exécution Turbo interrompue.');
  return status;
}

if (isMain(import.meta.url)) {
  try {
    const event = process.env.GITHUB_EVENT_NAME;
    const base = process.env.CI_BASE_SHA;
    const changed = event === 'pull_request'
      ? git(['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`, '--']).split('\0').filter(Boolean) : [];
    const scope = testScope(event, base, changed);
    const binary = join(dirname(require.resolve('turbo/package.json')), 'bin/turbo');
    const turbo = (args, capture) => {
      const result = spawnSync(process.execPath, [binary, ...args], { cwd: ROOT,
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
      if (result.error) throw result.error;
      if (capture && result.status !== 0) throw new Error('Lecture du plan Turbo échouée.');
      return capture ? result.stdout : result.status;
    };
    const summarize = (message) => {
      console.log(message);
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        `### Unit tests: ${process.env.CI_TEST_LANE}\n\n${message}\n\nLive tests remain excluded by their existing configuration.\n`);
    };
    process.exitCode = runLane({ lane: process.env.CI_TEST_LANE, scope, turbo, summarize });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
