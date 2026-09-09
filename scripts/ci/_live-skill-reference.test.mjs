import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLiveSkillReference } from './_live-skill-reference.mjs';
const path = (...parts) => parts.join('/');
const skill = path('.agents','skills','frontend-design');
const live = path(skill,'reference','colors.md');
const tracked = new Set([live]);
function accepts(source, target, suffix='') {
  const line=`[Colors](${target}${suffix})`;
  return isLiveSkillReference(source,line,line.indexOf('reference'),tracked);
}
test('lien relatif vers un fichier de skill tracké',()=>{
  assert.equal(accepts(path(skill,'SKILL.md'),path('reference','colors.md')),true);
  assert.equal(accepts(path(skill,'SKILL.md'),path('reference','colors.md'),'#contrast'),true);
});
test('lien depuis un autre skill et chemin depuis la racine',()=>{
  assert.equal(accepts(path('.agents','skills','other','SKILL.md'),path('..','frontend-design','reference','colors.md')),true);
  assert.equal(accepts('README.md',live),true);
  assert.equal(accepts(path(skill,'reference','degraded','documenter.md'),path('reference','colors.md')),true);
  assert.equal(accepts(path(skill,'reference','live.md'),path('reference','<action>.md')),true);
});
test('ancien chemin, fichier manquant et sortie du skill restent interdits',()=>{
  assert.equal(accepts('README.md',path('docs','reference','colors.md')),false);
  assert.equal(accepts(path(skill,'SKILL.md'),path('reference','missing.md')),false);
  assert.equal(accepts(path(skill,'SKILL.md'),path('..','..','..','..','docs','reference','colors.md')),false);
});
