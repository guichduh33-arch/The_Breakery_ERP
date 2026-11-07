import { appendFileSync } from 'node:fs';
import { isMain } from '../agents/lib.mjs';

export const REQUIRED = ['governance-guards', 'lint', 'typecheck', 'unit-tests', 'build'];
export function gate(needs) {
  const failures = REQUIRED.filter((name) => needs?.[name]?.result !== 'success');
  if (failures.length) throw new Error(`Required CI jobs not successful: ${failures.map((name) =>
    `${name} (${needs?.[name]?.result ?? 'missing'})`).join(', ')}`);
  return 'All required CI jobs passed, including every unit-test lane.';
}

if (isMain(import.meta.url)) {
  try {
    const needs = JSON.parse(process.env.CI_NEEDS ?? 'null');
    const report = ['## Required CI checks', '', '| Check | Result |', '|---|---|',
      ...REQUIRED.map((name) => `| ${name} | ${needs?.[name]?.result ?? 'missing'} |`), ''].join('\n');
    console.log(report);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    console.log(gate(needs));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
