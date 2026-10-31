import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const projects = { dev: 'ikcyvlovptebroadgtvd', rehearsal: 'getctmbpjnrrjzncaqze' };

export function resolveDbTestTarget(env) {
  const target = env.DB_TEST_TARGET || 'dev';
  if (!Object.hasOwn(projects, target)) throw new Error('Unknown cloud DB test target.');
  const connection = target === 'rehearsal' ? env.REHEARSAL_PGURL : env.DEV_PGURL;
  if (!connection) throw new Error(`Missing connection for ${target}; fallback is forbidden.`);
  let url;
  try { url = new URL(connection); } catch { throw new Error('Invalid DB connection URL.'); }
  const ref = projects[target];
  const user = decodeURIComponent(url.username);
  const pooler = url.hostname.endsWith('.pooler.supabase.com')
    && ['postgres.' + ref, 'cli_login_postgres.' + ref].includes(user);
  const direct = url.hostname === `db.${ref}.supabase.co` && user === 'postgres';
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!pooler && !direct)
    || !['', '5432'].includes(url.port) || url.hash
    || !url.password || !['', '/', '/postgres'].includes(url.pathname)
    || /[\r\n]/.test(connection)) throw new Error('DB connection does not match the selected cloud project.');
  const permittedOptions = new Set(['sslmode', 'connect_timeout', 'application_name']);
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (!permittedOptions.has(key) || seen.has(key)
      || (key === 'sslmode' && !['require', 'verify-ca', 'verify-full'].includes(value))
      || (key === 'connect_timeout' && !/^[1-9][0-9]?$/.test(value))
      || (key === 'application_name' && !/^[a-zA-Z0-9_-]{1,64}$/.test(value))) {
      throw new Error('Unsafe DB connection option.');
    }
    seen.add(key);
  }
  return { target, ref, connection };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const selected = resolveDbTestTarget(process.env);
    if (!process.env.GITHUB_ENV) throw new Error('GitHub environment output is required.');
    console.log(`::add-mask::${selected.connection}`);
    appendFileSync(process.env.GITHUB_ENV,
      `PGURL=${selected.connection}\nPGOPTIONS=-c jit=true\n`);
    console.log(`Cloud DB tests: ${selected.target} (${selected.ref}).`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
