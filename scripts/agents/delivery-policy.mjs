// Routage prudent : les chemins suggèrent les preuves, le mandat métier les complète.
export const STAGES = ['scoped', 'dev-verified', 'reviewed', 'integrated', 'ready', 'deployed', 'verified', 'closed'];
export const ROLES = {
  backoffice: 'backoffice-specialist', pos: 'pos-specialist', database: 'db-engineer',
  edge: 'edge-functions-engineer', tests: 'test-engineer', review: 'pattern-guardian',
};

export function deliveryPolicy(files, deliveryTarget = 'production') {
  if (!['production', 'dev', 'none'].includes(deliveryTarget)) throw new Error('Cible de livraison inconnue.');
  const has = (pattern) => files.some((path) => pattern.test(path));
  const shared = has(/^packages\/(domain|supabase|ui|utils)\//);
  const global = has(/^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tsconfig[^/]*\.json)$/);
  const surfaces = {
    backoffice: shared || global || has(/^apps\/backoffice\//),
    pos: shared || global || has(/^apps\/(pos|print-bridge)\//),
    database: has(/^(supabase\/(migrations|tests|functions)\/|\.github\/workflows\/pgtap-pr\.yml$|scripts\/ci\/db-gate(?:\.test)?\.mjs$)/),
    edge: has(/^supabase\/functions\//),
    tooling: has(/^(scripts\/|\.github\/|AGENTS\.md$|CLAUDE\.md$|\.agents\/|\.claude\/agents\/|\.codex\/agents\/)/),
  };
  const runtime = surfaces.backoffice || surfaces.pos || surfaces.database;
  const sensitivePaths = files.filter((path) => /(^|\/)\.env($|\.)|\.(pem|p12|keystore|jks)$/.test(path));
  const checks = [{ id: 'scope', stage: 'scoped', kind: 'attestation', role: 'primary', target: 'scope',
    purpose: 'Objectif utilisateur référencé ; périmètre et critères de résultat cadrés par l’agent.' }];
  const add = (id, stage, kind, role, target, purpose) => checks.push({ id, stage, kind, role, target, purpose });
  add('governance', 'dev-verified', 'command', 'primary', 'local', 'Gardes applicables et miroirs synchronisés.');
  if (surfaces.tooling) add('tooling-tests', 'dev-verified', 'node-tap', ROLES.tests, 'local', 'Tests Node de l’outillage.');
  if (runtime) {
    add('lint', 'dev-verified', 'command', ROLES.tests, 'local', 'Lint des fichiers concernés.');
    add('typecheck', 'dev-verified', 'command', ROLES.tests, 'local', 'Types des packages concernés.');
    add('targeted-tests', 'dev-verified', 'vitest', ROLES.tests, 'local', 'Scénarios de la demande et régressions pertinentes.');
  }
  if (surfaces.backoffice) add('bo-suite', 'dev-verified', 'vitest', ROLES.tests, 'local', 'Suite BO complète.');
  if (surfaces.pos) add('pos-suite', 'integrated', 'github', ROLES.tests, 'ci', 'Suite POS complète : preuve CI du candidat intégré.');
  if (surfaces.database) add('database-tests', 'dev-verified', 'attestation', ROLES.database, 'dev', 'pgTAP sur dev : assertions, refus, idempotence ; état DB daté.');
  if (surfaces.edge) add('edge-checks', 'dev-verified', 'command', ROLES.edge, 'local', 'Vérifications Deno et contrat appelant/serveur.');
  add('agents-audit', 'reviewed', 'attestation', 'primary', 'scope', 'Audit des consignes avant ouverture de PR.');
  add('review', 'reviewed', 'attestation', ROLES.review, 'scope', 'Revue indépendante ; constats montrés à Mamat.');
  add('integration', 'integrated', 'attestation', 'primary', 'github', 'PR fusionnée, SHA intégré et lien de PR vérifiés.');
  add('ci', 'integrated', 'github', ROLES.tests, 'ci', 'Contrôles GitHub réussis sur le candidat intégré.');
  const environment = deliveryTarget === 'none' ? 'scope' : deliveryTarget;
  add('release', 'ready', 'attestation', 'primary', environment, 'Décision de livraison validée par l’agent dans l’objectif demandé ; composants, paquet, cible, dépendances et retour vérifiés.');
  add('deployment', 'deployed', 'attestation', 'primary', environment, 'Mise en place observée pour chaque composant concerné.');
  add('acceptance', 'verified', 'attestation', 'primary', environment, 'Version chargée, cible et parcours réel observés.');
  add('closure', 'closed', 'attestation', 'primary', 'scope', 'Bilan et résidu explicites ; aucune suppression déduite de la clôture.');
  if (!runtime || deliveryTarget === 'none') {
    for (const check of checks.filter((item) => ['release', 'deployment', 'acceptance'].includes(item.id))) {
      check.allowNotApplicable = true;
      check.purpose += ' Lot sans livraison applicative : non-applicabilité motivée possible.';
    }
  }
  return { deliveryTarget, surfaces, roles: [...new Set(Object.entries(surfaces).filter(([, value]) => value)
    .map(([name]) => ROLES[name]).filter(Boolean).concat(ROLES.tests, ROLES.review))],
  checks, sensitivePaths, note: 'Le routage par chemin ne prouve pas la couverture métier. Compléter les contrôles selon le mandat ; aucune opération connectée n’est lancée.' };
}
