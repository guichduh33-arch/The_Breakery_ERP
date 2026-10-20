// Fixtures synthétiques partagées par les tests Node ; aucun exécutable n'est lancé.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const syntheticDump = Buffer.from('PGDMP synthetic fixture only');
export const syntheticListing = Buffer.from('; Archive created at synthetic date\n1; 0 42 TABLE public synthetic postgres\n');
export function databaseFixture(root, projectRef) {
  const tool = join(root, 'fake-tool');
  writeFileSync(tool, 'synthetic-native-tool');
  const config = { version: 1, projectRef, host: `db.${projectRef}.supabase.co`, port: 5432,
    database: 'postgres', user: 'postgres', passwordFile: join(root, 'pgpass'), rootCertificate: join(root, 'root.crt'),
    pgDump: { path: tool, sha256: createHash('sha256').update(readFileSync(tool)).digest('hex') } };
  config.pgRestore = { ...config.pgDump };
  writeFileSync(config.passwordFile, 'SYNTHETIC_PASSWORD_NOT_FOR_SERVER');
  writeFileSync(config.rootCertificate, 'SYNTHETIC_CA');
  return config;
}
export const syntheticCapture = async (_exe, args) => args.includes('--list') ? syntheticListing : syntheticDump;
