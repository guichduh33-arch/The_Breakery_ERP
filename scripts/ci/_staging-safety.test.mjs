import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const workflow = readFileSync(new URL('../../.github/workflows/staging-deploy.yml', import.meta.url),'utf8');
function script(name) {
  const section = workflow.split(`- name: ${name}`)[1]?.split('\n      - name:')[0];
  assert.ok(section, `step ${name} exists`);
  return section.split('run: |')[1].split('\n').map(line=>line.replace(/^ {10}/,'')).join('\n');
}
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
test('la cible est contrôlée avant link et les cibles absentes/inattendues échouent',()=>{
  assert.ok(workflow.indexOf('Sanity-check staging project ref') < workflow.indexOf('Link to staging Supabase project'));
  for (const ref of ['', 'unexpected-project']) {
    const result=spawnSync(bash,['-c',script('Sanity-check staging project ref')],{env:{...process.env,STAGING_REF:ref},encoding:'utf8'});
    assert.ifError(result.error); assert.equal(result.status,1);
  }
  const valid=spawnSync(bash,['-c',script('Sanity-check staging project ref')],{env:{...process.env,STAGING_REF:'ikcyvlovptebroadgtvd'},encoding:'utf8'});
  assert.ifError(valid.error); assert.equal(valid.status,0);
});
test('aucun replay global et arrêt explicite avant déploiement des fonctions',()=>{
  assert.doesNotMatch(workflow,/^\s*supabase db push/m);
  const gate='Require targeted schema validation before deployment';
  assert.ok(workflow.indexOf(gate)<workflow.indexOf('Deploy Edge Functions to staging'));
  const result=spawnSync(bash,['-c',script(gate)],{encoding:'utf8'});
  assert.ifError(result.error); assert.equal(result.status,1);
});
