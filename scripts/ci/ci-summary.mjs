import { appendFileSync } from 'node:fs';
import { isMain } from '../agents/lib.mjs';
import { githubReader } from '../release/preflight.mjs';

const cell = (value) => String(value ?? '').replace(/[|\r\n`]/g, ' ');
export function timingSummary(jobs, runUrl) {
  const rows = jobs.map((job) => {
    const start = Date.parse(job.started_at), end = Date.parse(job.completed_at);
    const seconds = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
    const failed = job.steps?.find((step) => ['failure', 'cancelled'].includes(step.conclusion));
    const detail = failed ? cell(failed.name) : '';
    return `| [${cell(job.name)}](${runUrl}/job/${job.id}) | ${cell(job.conclusion ?? job.status)} | ${seconds ?? 'pending'} | ${detail} |`;
  });
  return ['## CI timings and diagnostics', '', '| Job | Result | Seconds | First failed step |',
    '|---|---|---:|---|', ...rows, '', 'Job durations include setup and cache operations; parallel durations must not be added.',
    'Open a failed job for its exact error and the test command printed in its summary.', ''].join('\n');
}

if (isMain(import.meta.url)) {
  try {
    const get = githubReader(process.env.GITHUB_REPOSITORY, process.env.GITHUB_TOKEN);
    const id = process.env.GITHUB_RUN_ID;
    if (!/^[0-9]+$/.test(id ?? '')) throw new Error('Identifiant de run requis.');
    const jobs = [];
    for (let page = 1; page <= 100; page++) {
      const data = await get(`actions/runs/${id}/jobs?filter=latest&per_page=100&page=${page}`);
      if (!Array.isArray(data.jobs)) throw new Error('Liste de jobs invalide.');
      jobs.push(...data.jobs);
      if (data.jobs.length < 100) break;
      if (page === 100) throw new Error('Pagination incomplète.');
    }
    const report = timingSummary(jobs, `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${id}`);
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  } catch (error) { console.error(`CI timing report unavailable: ${error.message}`); process.exitCode = 1; }
}
