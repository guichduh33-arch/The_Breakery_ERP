// Assemble des preuves locales. Pas de client DB, de déploiement ou de secret.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ROOT, git } from '../agents/lib.mjs';
import { safePath } from './bundle-files.mjs';
import { SOURCE, TARGET } from './bootstrap-catalog.mjs';
import { renderSchema, renderChecks, literal, identifier, aclEntries, reviewEnvelope } from './bootstrap-render.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const normalized = (text) => text.replaceAll('\r\n', '\n');
const folder = '.release-manifests/v3-bootstrap';
const path = (name) => safePath(ROOT, `${folder}/${name}`);
const json = (name) => JSON.parse(readFileSync(path(name), 'utf8'));
function save(name, value) {
  writeFileSync(path(name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function files(directory) {
  return readdirSync(directory, { withFileTypes:true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error('Lien symbolique interdit.');
    if (['__tests__','node_modules'].includes(entry.name)) return [];
    const full = join(directory,entry.name);
    return entry.isDirectory() ? files(full) : /\.(?:tsx?|mjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name) ? [full] : [];
  });
}
export function insertReview(table, rows) {
  if (!rows.length) throw new Error(`Référentiel vide : ${table}`);
  const columns = Object.keys(rows[0]);
  if (rows.some((row) => JSON.stringify(Object.keys(row)) !== JSON.stringify(columns))) throw new Error('Colonnes hétérogènes.');
  const value = (v) => typeof v === 'boolean' ? String(v).toUpperCase() : typeof v === 'number' ? String(v) : literal(v);
  return `INSERT INTO public.${identifier(table)} (${columns.map(identifier).join(', ')}) VALUES\n` +
    rows.map((row) => `  (${columns.map((key) => value(row[key])).join(', ')})`).join(',\n') + ';\n';
}

export function compareEdge(root, live, config) {
  const uncommented = config.replace(/^\s*#.*$/gm, '');
  const configured = new Map([...uncommented.matchAll(/\[functions\.([^\]]+)\]\s*verify_jwt\s*=\s*(true|false)/g)]
    .map((match) => [match[1], match[2] === 'true']));
  return live.map((edge) => ({
    name:edge.slug, liveVersion:edge.version, liveVerifyJwt:edge.verify_jwt,
    configuredVerifyJwt:configured.get(edge.slug) ?? null,
    configurationStatus:!configured.has(edge.slug) ? 'absent_du_fichier' : configured.get(edge.slug) !== edge.verify_jwt ? 'divergence' : 'identique',
    files:edge.files.map((file) => {
      const suffix = file.name.startsWith('functions/') ? file.name.slice('functions/'.length) : file.name;
      if (suffix.includes('\\') || suffix.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Chemin EF hors périmètre.');
      if (!suffix.startsWith(`${edge.slug}/`) && !suffix.startsWith('_shared/')) throw new Error('Chemin EF inattendu.');
      const localPath = safePath(root, `supabase/functions/${suffix}`);
      const local = existsSync(localPath) ? readFileSync(localPath, 'utf8') : null;
      return { path:`supabase/functions/${suffix}`, liveSha256:sha256(normalized(file.content)),
        sourceSha256:local == null ? null : sha256(normalized(local)),
        equalIgnoringLineEndings:local != null && normalized(local) === normalized(file.content) };
    }),
  }));
}

export function inspectContracts(snapshot, sources, permissions, permissionSource) {
  const names = new Set(snapshot.functions.map((fn) => fn.name));
  const calls = [];
  for (const source of sources) for (const match of source.content.matchAll(/\.rpc(?:<[^;\n]+?>)?\s*\(\s*['"]([^'"]+)['"]/g))
    calls.push({ name:match[1], file:source.path, line:source.content.slice(0,match.index).split('\n').length });
  const typeBody = /export type PermissionCode\s*=([\s\S]*?);/.exec(permissionSource)?.[1];
  if (!typeBody) throw new Error('Catalogue TS de permissions introuvable.');
  const declared = new Set([...typeBody.matchAll(/\|\s*'([^']+)'/g)].map((match) => match[1]));
  const seeded = new Set(permissions.map((permission) => permission.code));
  return {
    scope:'Appels RPC à nom littéral seulement ; les noms calculés et arguments exigent une vérification complémentaire.',
    literalCalls: calls.length, uniqueLiteralNames:new Set(calls.map((call) => call.name)).size,
    missingRpc: calls.filter((call) => !names.has(call.name)),
    permissionCodesOnlyInSource:[...declared].filter((name) => !seeded.has(name)),
    permissionCodesOnlyInDatabase:[...seeded].filter((name) => !declared.has(name)),
  };
}

export function assemble() {
  const snapshot = json('catalog.json');
  if (snapshot.source !== SOURCE || snapshot.target !== TARGET || !snapshot.functionsComplete || snapshot.transactionallyConsistentSnapshot !== true)
    throw new Error('Source/cible ou extraction incomplète.');
  if (git(['rev-parse','HEAD']) !== snapshot.sourceSha) throw new Error('Le checkout a changé depuis le relevé.');
  const references = json('references-review.json');
  const recheck = json('source-recheck.json');
  const recheckedFunctions = new Map(recheck.functions.map((fn) => [fn.oid,fn]));
  const changedFunctions = snapshot.functions.filter((fn) => {
    const current = recheckedFunctions.get(fn.oid);
    return current?.definition_md5 !== createHash('md5').update(fn.definition).digest('hex') || current?.acl !== fn.acl;
  });
  if (changedFunctions.length || snapshot.functions.length !== recheck.functions.length) throw new Error('Les fonctions ont changé depuis l’extraction.');
  const live = json('edge-live-source.json');
  const sourceFiles = ['apps/pos/src','apps/backoffice/src','apps/print-bridge/src','packages/supabase/src','supabase/functions']
    .flatMap((directory) => files(safePath(ROOT,directory)));
  const sources = sourceFiles.map((file) => ({ path:relative(ROOT,file).replaceAll('\\','/'),content:readFileSync(file,'utf8') }));
  const contracts = inspectContracts(snapshot,sources,references.permissions,readFileSync(join(ROOT,'packages/supabase/src/rls/permissions.ts'),'utf8'));
  const edge = compareEdge(ROOT,live,readFileSync(join(ROOT,'supabase/config.toml'),'utf8'));
  const env = new Map();
  for (const source of sources.filter((file) => file.path.startsWith('supabase/functions/')))
    for (const match of source.content.matchAll(/Deno\.env\.get\(['"]([^'"]+)['"]\)/g))
      env.set(match[1],[...(env.get(match[1]) ?? []),source.path]);
  const metadata = { source:SOURCE,target:TARGET,sourceSha:snapshot.sourceSha,capturedAt:snapshot.context[0].captured_at,
    localSchemaChanges:snapshot.localSchemaChanges ?? [],
    status:'review_only_not_executed',transactionallyConsistentSnapshot:true,
    acquisition:'Schéma acquis dans une instruction SELECT unique (snapshot MVCC), référentiels candidats lus séparément ; aucun historique métier ni secret Vault.',
    functionRecheck:{count:recheck.functions.length,changed:0},productionObserved:recheck.production };
  const findings = {
    ...metadata,contracts,
    sourceSpecificReferences:snapshot.functions.filter((fn) => /ikcyvlovptebroadgtvd|abjabuniwkqpfsenxljp|breakery_backup_/.test(fn.definition)).map((fn) => fn.name),
    anonymousFunctions:snapshot.functions.filter((fn) => aclEntries(fn.acl ?? '{=X/postgres}')
      .some((acl) => ['PUBLIC','anon'].includes(acl.role) && acl.permissions.some((p) => p.name === 'EXECUTE')))
      .map((fn) => ({name:fn.name,securityDefiner:fn.security_definer,comment:fn.comment})),
    edgeConfigurationDifferences:edge.filter((fn) => fn.configurationStatus!=='identique').map((fn) => ({
      name:fn.name,liveVersion:fn.liveVersion,liveVerifyJwt:fn.liveVerifyJwt,
      configuredVerifyJwt:fn.configuredVerifyJwt,configurationStatus:fn.configurationStatus,
    })),
    edgeSourceDifferences:edge.flatMap((fn) => fn.files.filter((file) => !file.equalIgnoringLineEndings).map((file) => ({function:fn.name,...file}))),
    limits:['Pas de restauration exécutée.','Pas de test pgTAP ou E2E exécuté sur la cible.',
      'Le SQL ne provient pas de pg_dump : ordre et couverture à éprouver avant approbation.',
      'Paramètres Auth/Data API, signature JWT, secrets, sauvegardes et accès réseau à vérifier hors schéma.',
      'Aucune reprise du bookkeeping dev ; convention de suivi du socle et des prochaines migrations à valider.'],
    blockedSecurityChanges:{
      status:'proposal_withdrawn_after_automatic_review_rejection',
      functions:['verify-manager-pin','refund-order','void-order','cancel-item','notification-dispatch','customer-birthday-notify','lan-heartbeat-batch'],
      proposedChange:'Utiliser leur authentification interne, sans vérification JWT préalable de la passerelle Supabase.',
      applied:false,
    },
    kioskSecurity:{status:'implemented_locally_database_applied_dev_only',
      finding:'La version EF déployée reste ancienne et permet une émission non appairée. Le correctif local exige une activation par session autorisée puis un secret propre à chaque appareil.',
      accessFinding:'Le nouveau rôle kiosk_display ne lit aucune table métier. Sa projection dédiée vérifie la révocation à chaque appel ; le correctif EF émet exclusivement ce rôle pour les écrans.',
      acceptedPairing:'Appairage validé par Mamat : code de dix minutes, secret appareil, reconnexion, révocation et données limitées à l’affichage.',
      excludedFromJwtChange:true,requires:'Vérification complète EF → Data API → écran avant déploiement. En environnement existant : couper l’ancienne émission et attendre l’expiration de tous les anciens JWT (24 h) avant de considérer leur accès révoqué. La production vierge n’a pas ces jetons.'},
  };
  save('schema-review.sql',renderSchema(snapshot));
  save('post-init-readonly.sql',renderChecks(snapshot));
  const barrier = "-- CANDIDAT DE REVUE : aucun référentiel approuvé pour insertion.\nDO $review$ BEGIN RAISE EXCEPTION 'review_only_not_approved_for_execution'; END $review$;\n";
  save('reference-data-review.sql',reviewEnvelope(barrier + ['permissions','roles','accounts','accounting_mappings','units','unit_conversions']
    .map((name) => `\n-- ${name} : origine dev ; aucune valeur de solde ou stock.\n` + insertReview(name,references[name])).join('')));
  const syntaxProof = existsSync(path('sql-parse-validation.json')) ? json('sql-parse-validation.json') : null;
  findings.sqlSyntax = {status:syntaxProof?.files?.length === 3 && syntaxProof.files.every((file) =>
    ['schema-review.sql','reference-data-review.sql','post-init-readonly.sql'].includes(file.file) &&
    file.syntax_valid && file.sha256 === sha256(readFileSync(path(file.file)))) ? 'passed' : 'missing_or_stale',
    scope:'Syntaxe des fichiers identifiés par SHA-256 seulement ; aucune preuve d’installation.'};
  save('edge-manifest.json',{...metadata,functions:edge,environmentVariables:[...env].sort().map(([name,consumers]) => ({name,consumers:[...new Set(consumers)],valueIncluded:false}))});
  save('findings.json',findings);
  save('opening-inputs.json',{
    ...metadata,superAdmin:{fullName:'mamat',roleCode:'SUPER_ADMIN',employeeCode:null,credentialHandling:'Secret transmis hors fichiers ; aucune valeur ni empreinte de PIN conservée.',status:'not_created'},
    roleMatrix:{status:'not_approved',grantsIncluded:false},
    businessConfiguration:{status:'not_approved',schemaDefaults:snapshot.relations.find((r) => r.name==='business_config').columns.filter((c) => !['created_at','updated_at'].includes(c.name)).map((c) => ({name:c.name,defaultExpression:c.default}))},
    catalogue:{source:null,status:'pending'},openingStock:{source:null,date:null,status:'pending'},openingBalances:{source:null,date:null,status:'pending'},fiscalPeriods:{year:null,status:'pending'},
    operations:{isolatedRehearsalTarget:null,productionApplicationApproved:false,applicationCutoverApproved:false},
  });
  save('services-review.json',{...metadata,buckets:snapshot.buckets,cron:snapshot.cron,
    notice:'Les commandes des crons HTTP et tous les secrets sont volontairement absents. Aucun cron ne sera activé par le SQL de schéma. Les buckets sont des candidats de configuration sans fichiers.'});
  const counts = {tables:snapshot.relations.filter((r) => ['r','p'].includes(r.kind)).length,
    views:snapshot.relations.filter((r) => r.kind==='v').length,materializedViews:snapshot.relations.filter((r) => r.kind==='m').length,
    enums:snapshot.types.length,functions:snapshot.functions.length,sequences:snapshot.sequences.length,policies:snapshot.policies.length,triggers:snapshot.triggers.length};
  save('review.md',`# Préparation V3 production — relevé du ${snapshot.context[0].captured_at}\n\n` +
    `Cible : **${TARGET}**, the-breakery-v3-prod, Singapour. Source Git : ${snapshot.sourceSha}.\n\n` +
    'Le SHA désigne la base Git ; le candidat inclut les modifications locales de la branche de préparation, dont l’appairage sécurisé.\n\n' +
    '**État : dossier de revue local. Aucune installation exécutée, aucun compte créé, aucune application basculée.**\n\n' +
    `Le candidat contient ${counts.tables} tables (partitions comprises), ${counts.views} vues, ${counts.materializedViews} vues matérialisées, ${counts.enums} enums, ${counts.functions} fonctions, ${counts.sequences} séquences, ${counts.policies} politiques et ${counts.triggers} triggers.\n\n` +
    '## Contenu à relire\n\n' +
    '- [Schéma SQL](schema-review.sql) : structure live, droits et protections. Un verrou bloque toute exécution accidentelle.\n' +
    '- [Référentiels candidats](reference-data-review.sql) : permissions, rôles système, comptes/mappings comptables et unités. Validation distincte nécessaire ; aucune matrice rôle × permission reprise.\n' +
    '- [Compte et paramètres d’ouverture](opening-inputs.json) : mamat prévu SUPER_ADMIN ; code employé, configuration métier, catalogue, stocks, soldes et année fiscale encore à renseigner/valider. Aucun PIN enregistré.\n' +
    '- [Edge Functions](edge-manifest.json) : empreintes source/live, réglages JWT et noms de variables nécessaires, jamais leurs valeurs.\n' +
    '- [Stockage et tâches planifiées](services-review.json) : inventaire sans fichiers ni secrets ; aucune activation.\n' +
    '- [Écarts et limites](findings.json) : résultats détaillés du rapprochement statique.\n\n' +
    '- [Contrôles après initialisation](post-init-readonly.sql) : requêtes de vérification en lecture seule, non exécutées sur la cible vierge.\n\n' +
    '## Résultats du rapprochement\n\n' +
    `- ${contracts.uniqueLiteralNames} noms de RPC littéraux contrôlés ; ${contracts.missingRpc.length} occurrences sans fonction correspondante. Ce relevé ne valide pas les arguments ni les noms calculés.\n` +
    `- Permissions : ${contracts.permissionCodesOnlyInSource.length} codes uniquement côté TS ; ${contracts.permissionCodesOnlyInDatabase.length} uniquement en DB.\n` +
    `- EF : ${findings.edgeSourceDifferences.length} différences de fichiers source/live ; ${findings.edgeConfigurationDifferences.length} réglages JWT absents ou différents du fichier local. Ces écarts ne sont pas corrigés automatiquement.\n\n` +
    'Écarts concrets observés : le modèle PDF de stock déployé utilise encore l’ancien format ; le bundle kiosque diffère de master (dont les en-têtes CORS) ; la vérification JWT de verify-manager-pin est désactivée en dev mais activée dans le fichier local.\n\n' +
    '## Vérifications locales\n\n' +
    'Le schéma provient désormais d’une seule requête, donc d’un même snapshot. Les tests et le lint JavaScript ciblé sont consignés dans [les preuves de validation](validation.json).\n\n' +
    (existsSync(path('pairing-validation.json')) ? 'Le lot d’appairage a ses [preuves de validation et limites](pairing-validation.json), dont les vérifications PostgreSQL en transaction annulée et la suite back-office complète.\n\n' : '') +
    `Validation de syntaxe PostgreSQL : **${findings.sqlSyntax.status}** ([preuves avec empreintes](sql-parse-validation.json)). Ce contrôle ne remplace pas une installation de répétition.\n\n` +
    '## Modifications de sécurité bloquées\n\n' +
    'La modification groupée des réglages JWT a été retirée après le refus du contrôle automatique : aucun réglage n’a changé. L’appairage sécurisé validé par Mamat est implémenté localement ; son schéma additif est appliqué uniquement en dev. Les fonctions et les applications ne sont pas déployées. Le nouveau rôle technique fait partie du SQL candidat.\n\n' +
    'Le correctif local du traitement des anniversaires refuse désormais les sessions utilisateur ordinaires et exige un justificatif serveur configuré. Les tests unitaires locaux couvrent aussi les refus du dispatcher de notifications et des remontées appareils. Ils simulent les services externes : ils ne prouvent ni la passerelle Supabase, ni les permissions réelles en base, ni le fonctionnement en production. Aucun correctif n’est déployé.\n\n' +
    '## Conditions non satisfaites pour exécuter\n\n' +
    findings.limits.map((item) => `- ${item}\n`).join('') +
    '- Validation du SQL et des référentiels par Mamat ; résolution des écarts avant tout déploiement.\n' +
    '- Une base structurée sans référentiels, utilisateur, configuration métier et EF ne constitue pas une application utilisable.\n\n' +
    'Les données de test, le schéma de sauvegarde dev, les comptes dev, les états de séquences et les secrets ne sont pas repris. Les vues matérialisées sont créées sans données et devront être rafraîchies après initialisation.\n');
  const artifactNames = ['catalog.json','source-recheck.json','references-review.json','schema-review.sql','reference-data-review.sql','post-init-readonly.sql','edge-manifest.json','findings.json','opening-inputs.json','services-review.json','review.md','validation.json'];
  if (findings.sqlSyntax.status === 'passed') artifactNames.push('sql-parse-validation.json');
  for (const name of ['pairing-validation.json','pairing-pgtap.json']) if (existsSync(path(name))) artifactNames.push(name);
  save('manifest.json',{...metadata,counts,files:artifactNames.map((name) => ({name,sha256:sha256(readFileSync(path(name)))})),
    generators:['bootstrap-catalog.mjs','bootstrap-render.mjs','bootstrap-review.mjs','bootstrap-parse.py'].map((name) => ({name,sha256:sha256(readFileSync(join(ROOT,'scripts/release',name)))}))});
  return {folder,counts,contracts,edgeSourceDifferences:findings.edgeSourceDifferences.length,edgeConfigurationDifferences:findings.edgeConfigurationDifferences};
}

const comparablePath = (name) => process.platform === 'win32' ? resolve(name).toLowerCase() : resolve(name);
if (process.argv[1] && comparablePath(process.argv[1]) === comparablePath(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.length!==2) throw new Error('Aucun argument accepté ; génération locale seulement.');
    console.log(JSON.stringify(assemble(),null,2));
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
