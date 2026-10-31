import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inside = path => !relative(root, path).startsWith('..') && !relative(root, path).startsWith('/');

function expand(path, parents = []) {
  if (!inside(path) || parents.includes(path) || parents.length > 10) throw new Error('Unsafe SQL include.');
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replace(/^\s*\\ir\s+([^\r\n]+)\s*$/gm,
    (_, include) => expand(resolve(dirname(path), include.trim()), [...parents, path]));
}

export function prepareSql(sql, fixtures) {
  if (!/^BEGIN\s*;/m.test(sql) || !/^ROLLBACK\s*;\s*$/m.test(sql)
    || /^\s*(?:COMMIT|END\s+TRANSACTION)\b/im.test(sql)
    || !/ROLLBACK\s*;\s*$/.test(sql)) throw new Error('SQL test must end in rollback without commit.');
  // RESET ROLE revient au login CI NOINHERIT. Le rôle de travail autorisé est postgres.
  return sql.replace(/\bRESET\s+ROLE\s*;/gi, 'SET LOCAL ROLE postgres;')
    .replace(/^BEGIN\s*;/m, 'BEGIN;\nSET LOCAL search_path=public,extensions,pg_temp;\n' + fixtures + '\n');
}

export function prepareTestFile(input) {
  const path = resolve(input);
  if (!inside(path) || !path.endsWith('.test.sql')) throw new Error('SQL test path required.');
  return prepareSql(expand(path), readFileSync(join(root, 'helpers/rehearsal_suite.sql'), 'utf8'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const sql = prepareTestFile(process.argv[2] || '');
    const output = join(mkdtempSync(join(tmpdir(), 'breakery-pgtap-')), 'test.sql');
    writeFileSync(output, sql, { flag: 'wx', mode: 0o600 });
    console.log(output);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
