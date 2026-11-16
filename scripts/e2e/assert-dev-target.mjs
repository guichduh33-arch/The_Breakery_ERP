import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEV_REF = 'ikcyvlovptebroadgtvd';
const DEV_URL = `https://${DEV_REF}.supabase.co`;
const REJECTION = 'E2E target must identify dev V3 in both frontend and SQL configuration.';

function reject() { throw new Error(REJECTION); }

/** Vérification locale uniquement ; aucune connexion ni valeur sensible affichée. */
export function assertDevTarget(env = process.env) {
  if (env.VITE_SUPABASE_URL !== DEV_URL) reject();
  const raw = env.PGURL;
  if (typeof raw !== 'string' || raw.length > 4096 || /[\s\0]/.test(raw)
    || !/^postgres(?:ql)?:\/\//.test(raw) || /%(?![\da-f]{2})/i.test(raw)) reject();
  // WHATWG réduit les segments « . »/« .. », alors que libpq reçoit le nom brut.
  // Exiger le chemin canonique avant tout parsing évite ce désaccord de cible.
  const rawPath = /^postgres(?:ql)?:\/\/[^/?#]+(\/[^?#]*)(?:\?[^#]*)?$/.exec(raw)?.[1];
  if (rawPath !== '/postgres') reject();
  let sql;
  let username;
  try {
    sql = new URL(raw);
    username = decodeURIComponent(sql.username);
  } catch { reject(); }
  if (!sql || !username || !sql.password || sql.hash || sql.pathname !== '/postgres') reject();
  const options = new Set();
  for (const [key, value] of sql.searchParams) {
    if (options.has(key)) reject();
    options.add(key);
    if (key === 'sslmode' && ['require', 'verify-ca', 'verify-full'].includes(value)) continue;
    if (key === 'connect_timeout' && /^(?:[1-9]|[1-5]\d|60)$/.test(value)) continue;
    // Les paramètres libpq host/user/service/options peuvent changer la cible.
    reject();
  }
  const direct = sql.hostname === `db.${DEV_REF}.supabase.co`
    && username === 'postgres' && ['', '5432'].includes(sql.port);
  const pooler = /^[a-z\d](?:[a-z\d-]*[a-z\d])?\.pooler\.supabase\.com$/.test(sql.hostname)
    && username === `postgres.${DEV_REF}` && ['', '5432', '6543'].includes(sql.port);
  if (!direct && !pooler) reject();
  return { projectRef: DEV_REF, connection: direct ? 'direct' : 'pooler' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assertDevTarget();
    process.stdout.write('DEV V3 target verified.\n');
  } catch {
    // Ne jamais exposer l'erreur URL native, sa cause, ni les variables entrantes.
    process.stderr.write('DEV V3 target verification failed.\n');
    process.exitCode = 1;
  }
}
