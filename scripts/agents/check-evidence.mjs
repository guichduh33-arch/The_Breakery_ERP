import { readFileSync } from 'node:fs';
import { testEvidence } from './test.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Un rapport JSON Vitest est requis.');
  const evidence = testEvidence(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log(JSON.stringify(evidence));
  process.exitCode = evidence.valid ? 0 : 1;
} catch { console.error('Preuve Vitest absente ou invalide.'); process.exitCode = 1; }
