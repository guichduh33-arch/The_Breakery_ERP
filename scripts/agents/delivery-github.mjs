// Lectures GET uniquement ; aucune action GitHub ni récupération d’artefacts privés.
export async function githubEvidence(current, records, get) {
  const results = new Map();
  for (const record of records.filter((item) => ['ci', 'pos-suite'].includes(item?.id))) {
    try {
      if (!Number.isSafeInteger(record.runId) || record.runId <= 0) throw new Error('Identifiant de run requis.');
      if (!get) throw new Error('Lecture GitHub authentifiée requise (GITHUB_TOKEN et GITHUB_REPOSITORY).');
      const runs = await get(`actions/workflows/ci.yml/runs?head_sha=${current.sourceSha}&event=push&per_page=100`);
      const candidates = runs.workflow_runs;
      if (!Array.isArray(candidates)) throw new Error('Réponse GitHub invalide.');
      const latest = candidates.filter((run) => run.head_sha === current.sourceSha && run.event === 'push')
        .sort((a, b) => b.id - a.id)[0];
      if (!latest || latest.id !== record.runId || latest.status !== 'completed' || latest.conclusion !== 'success') throw new Error('Dernière CI push du candidat absente, différente ou non réussie.');
      const jobs = [];
      for (let page = 1; page <= 100; page++) {
        const data = await get(`actions/runs/${latest.id}/jobs?filter=latest&per_page=100&page=${page}`);
        if (!Array.isArray(data.jobs)) throw new Error('Jobs GitHub invalides.');
        jobs.push(...data.jobs);
        if (data.jobs.length < 100) break;
        if (page === 100) throw new Error('Pagination GitHub incomplète.');
      }
      for (const name of ['governance-guards', 'lint-typecheck-test-build']) {
        if (!jobs.some((job) => job.name === name && job.status === 'completed' && job.conclusion === 'success')) throw new Error(`Job CI requis non réussi : ${name}`);
      }
      results.set(record.id, null);
    } catch (error) { results.set(record.id, error.message); }
  }
  return results;
}
