import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, ROOT } from '../agents/lib.mjs';
import { inventory } from './bundle-files.mjs';
import { validateProject } from './preflight.mjs';

export function verifyBuild(root, projectRef) {
  validateProject(projectRef);
  const expected = `https://${projectRef}.supabase.co`;
  const output = join(root, '.vercel/output/static');
  const localFiles = inventory(root, 'apps/backoffice/dist');
  const outputFiles = inventory(root, '.vercel/output/static');
  if (!localFiles.some((file) => file.path === 'index.html') || JSON.stringify(localFiles) !== JSON.stringify(outputFiles))
    throw new Error('La sortie Vercel ne correspond pas à tous les fichiers du bundle BO construit.');
  const scripts = outputFiles.filter((file) => /\.js$/.test(file.path)).map((file) => join(output, file.path));
  const urls = new Set(scripts.flatMap((file) => readFileSync(file, 'utf8').match(/https:\/\/[a-z]{20}\.supabase\.co/g) ?? []));
  if (!urls.has(expected) || [...urls].some((url) => url !== expected)) {
    throw new Error('Le bundle doit référencer uniquement la cible Supabase production confirmée.');
  }
  return { verified: true, scripts: scripts.length, target: projectRef };
}
if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(verifyBuild(ROOT, process.env.SUPABASE_PROJECT_REF_PRODUCTION))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
