import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ROOT, filesUnder, isMain, normalized, read, slash } from './lib.mjs';

// Ces copies fournies par les outils ont leur propre contrat de mise à jour.
export const VENDOR_SKILLS = new Set(['playwright-cli', 'impeccable']);
const toClaude = (text) => text.replaceAll('AGENTS.md', 'CLAUDE.md');
const toCodex = (text) => text.replaceAll('CLAUDE.md', 'AGENTS.md');

export function roleToToml(source) {
  const match = normalized(source).match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Frontmatter de profil absent.');
  const field = (key) => {
    const value = match[1].split('\n').find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2);
    if (!value) throw new Error(`Champ de profil absent : ${key}`);
    return value.startsWith('"') ? JSON.parse(value) : value;
  };
  const body = toCodex(match[2]).trim() + '\n';
  // Le modèle et les outils Claude ne deviennent pas des paramètres Codex.
  return '# Généré par scripts/agents/sync.mjs ; modifier le profil Markdown source.\n'
    + `name = ${JSON.stringify(field('name'))}\n`
    + `description = ${JSON.stringify(toCodex(field('description')))}\n`
    + `developer_instructions = ${JSON.stringify(body)}\n`;
}

export function expectedMirrors(root = ROOT) {
  const result = new Map();
  result.set('CLAUDE.md', read(join(root, 'AGENTS.md')).replace(/^# AGENTS\.md/, '# CLAUDE.md')
    .replace('Co-author Codex si assisté.', 'Co-author Claude si assisté.'));
  const skills = join(root, '.agents/skills');
  for (const entry of readdirSync(skills, { withFileTypes: true })) {
    if (!entry.isDirectory() || VENDOR_SKILLS.has(entry.name)) continue;
    if (!existsSync(join(skills, entry.name, 'SKILL.md'))) throw new Error(`Skill sans entrée : ${entry.name}`);
    for (const file of filesUnder(join(skills, entry.name))) {
      const rel = slash(relative(skills, file));
      let content = toClaude(read(file));
      // Impeccable reste fourni dans l'arbre canonique, sans copie Claude.
      content = content.replaceAll('../../impeccable/SKILL.md',
        slash(relative(dirname(join(root, '.claude/skills', rel)), join(skills, 'impeccable/SKILL.md'))));
      if (entry.name === 'playwright-fr') content = content.replaceAll('.agents/skills/playwright-cli/', '.claude/skills/playwright-cli/');
      result.set(`.claude/skills/${rel}`, content);
    }
  }
  for (const file of filesUnder(join(root, '.claude/agents')).filter((path) => path.endsWith('.md'))) {
    const name = slash(relative(join(root, '.claude/agents'), file));
    result.set(`.codex/agents/${name.replace(/\.md$/, '.toml')}`, roleToToml(read(file)));
  }
  return result;
}

export function syncMirrors(root = ROOT, write = false) {
  const expected = expectedMirrors(root);
  const changed = [];
  const orphaned = [];
  const skillDir = join(root, '.claude/skills');
  // Un retrait de source n'autorise jamais la suppression automatique d'une copie.
  for (const entry of readdirSync(skillDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || VENDOR_SKILLS.has(entry.name)) continue;
    for (const file of filesUnder(join(skillDir, entry.name))) {
      const rel = slash(relative(root, file));
      if (!expected.has(rel)) orphaned.push(rel);
    }
  }
  for (const file of filesUnder(join(root, '.codex/agents')).filter((path) => path.endsWith('.toml'))) {
    const rel = slash(relative(root, file));
    if (!expected.has(rel)) orphaned.push(rel);
  }
  if (write && orphaned.length) throw new Error(`Copies sans source à examiner : ${orphaned.join(', ')}`);
  for (const [path, content] of expected) {
    const target = join(root, path);
    if (existsSync(target) && read(target) === content) continue;
    changed.push(path);
    if (write) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf8');
    }
  }
  return { changed, orphaned, total: expected.size };
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => !['--check', '--write'].includes(arg))) {
      throw new Error('Usage : node scripts/agents/sync.mjs [--check|--write]');
    }
    const write = args.includes('--write');
    const result = syncMirrors(ROOT, write);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.orphaned.length || (!write && result.changed.length) ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
