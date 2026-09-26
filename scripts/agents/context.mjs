import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ROOT, git, inside, isMain, slash } from './lib.mjs';

export function findPackage(path, root = ROOT) {
  let dir = existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
  while (dir !== root && dir !== dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) return { dir, ...JSON.parse(readFileSync(manifest, 'utf8')) };
    dir = dirname(dir);
  }
  return null;
}
const words = (value) => value.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().split(/[^a-z0-9]+/)
  .filter((word) => word.length > 2 && !/^\d+$|^v\d+$/.test(word) &&
    !['src', 'page', 'pages', 'test', 'tests', 'spec', 'smoke', 'tsx', 'jsx', 'sql', 'mjs', 'cjs', 'hooks', 'components', 'index', 'use'].includes(word));

export function routeSkills(path) {
  if (path.startsWith('supabase/migrations/')) return ['db-migrations'];
  if (path.startsWith('supabase/functions/')) return ['edge-functions'];
  if (path.startsWith('supabase/tests/')) return ['db-migrations'];
  if (/^(\.github\/|scripts\/release\/)/.test(path)) return [];
  const skills = [];
  if (path.startsWith('apps/pos/')) skills.push('pos-flow-audit');
  if (path.startsWith('apps/backoffice/') || path.startsWith('packages/ui/')) skills.push('breakery-ui-kit');
  if (/\/(inventory|recipes|production|stock)/.test(path)) skills.push('stock-management');
  const mappings = { accounting: 'accounting', expenses: 'expense-governance', b2b: 'b2b-credit',
    orders: 'orders', products: 'products-catalog', reports: 'report-audit', auth: 'security-auth' };
  for (const [part, skill] of Object.entries(mappings)) if (new RegExp(`/${part}(?:/|-)`).test(path)) skills.push(skill);
  return [...new Set(skills)];
}

export function contextFor(input, root = ROOT, tracked = null) {
  const path = inside(root, input);
  const rel = slash(relative(root, path));
  if (!existsSync(path)) throw new Error(`Chemin absent : ${rel}`);
  const pkg = findPackage(path, root);
  const files = [...new Set(tracked ?? git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'apps', 'packages', 'supabase/tests', 'tests/e2e', 'scripts'], root).split('\0'))];
  const release = rel === '.github/workflows/production-backoffice.yml';
  const scope = pkg ? `${slash(relative(root, pkg.dir))}/` : release ? 'scripts/release/'
    : rel.startsWith('scripts/') || rel.startsWith('.github/') ? 'scripts/'
      : rel.startsWith('supabase/') ? 'supabase/tests/' : '';
  const tokens = release ? ['preflight', 'manifest']
    : rel === '.github/workflows/pgtap-pr.yml' ? ['gate'] : words(rel.split('/').at(-1));
  const feature = rel.match(/\/features\/([^/]+)\//)?.[1];
  const tests = files.filter((file) => file.startsWith(scope) &&
    (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || (rel.startsWith('supabase/') && /^supabase\/tests\/.*\.sql$/.test(file))))
    .map((file) => ({ file, score: file === rel ? 100 : words(file).filter((word) => tokens.includes(word)).length
      + (feature && file.includes(`/features/${feature}/`) ? 2 : 0) }))
    .filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return { path: rel, package: pkg?.name ?? null, packageRoot: pkg ? slash(relative(root, pkg.dir)) : null,
    skillsSuggested: routeSkills(rel), note: 'Suggestions par chemin, à confirmer selon la demande ; aucun skill ni test exécuté.',
    tests: tests.slice(0, 25).map(({ file }) => file), candidateCount: tests.length,
    testCommand: pkg && tests.some(({ file }) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file))
      ? 'node scripts/agents/test.mjs <fichier-vitest-découvert>' : null,
    sqlTestNote: tests.some(({ file }) => file.endsWith('.sql'))
      ? 'Tests SQL candidats : procédure cloud autorisée, pas le lanceur Vitest local.' : null,
    live: pkg?.name === '@breakery/supabase-tests' };
}
if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage : node scripts/agents/context.mjs <chemin>');
    console.log(JSON.stringify(contextFor(process.argv[2]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
