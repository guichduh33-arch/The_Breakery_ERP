import { createHash } from 'node:crypto';
import { ROOT, git } from './lib.mjs';
import { deliveryPolicy } from './delivery-policy.mjs';

const split = (text) => text.split('\0').filter(Boolean);
export function snapshot(root = ROOT, base = 'origin/master', runGit = git, deliveryTarget = 'production') {
  if (!base || base.startsWith('-') || /[\s\0]/.test(base)) throw new Error('Référence de base invalide.');
  const baseSha = runGit(['rev-parse', '--verify', `${base}^{commit}`], root);
  const sourceSha = runGit(['rev-parse', 'HEAD'], root);
  const mergeBase = runGit(['merge-base', baseSha, sourceSha], root);
  const committed = split(runGit(['diff', '--name-only', '--no-renames', '-z', `${mergeBase}..${sourceSha}`, '--'], root));
  const local = split(runGit(['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'], root));
  const untracked = split(runGit(['ls-files', '--others', '--exclude-standard', '-z'], root));
  const files = [...new Set([...committed, ...local, ...untracked])].sort();
  const dirty = Boolean(runGit(['status', '--porcelain=v1', '--untracked-files=normal'], root));
  const identity = { sourceSha, baseSha, mergeBase, files, deliveryTarget };
  return { schemaVersion: 1, observedAt: new Date().toISOString(),
    branch: runGit(['branch', '--show-current'], root) || 'detached', base, ...identity, dirty,
    fingerprint: createHash('sha256').update(JSON.stringify(identity)).digest('hex'), policy: deliveryPolicy(files, deliveryTarget),
    limits: ['Une base locale peut être périmée : actualiser origin/master avant reprise.',
      'Après intégration, fournir --base avec le SHA de base du lot conservé avant fusion ; un périmètre vide bloque la validation.',
      'Les preuves sont refusées sur un checkout sale ; aucun contenu de fichier métier ou secret n’est lu.',
      'Une intégration Git ne prouve aucun déploiement ni aucune installation.'] };
}
