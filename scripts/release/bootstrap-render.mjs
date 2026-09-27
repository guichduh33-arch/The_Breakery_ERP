// Produit un SQL de revue, jamais un exécuteur de déploiement.
export const identifier = (value) => '"' + String(value).replaceAll('"', '""') + '"';
export const literal = (value) => value == null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
const qualified = (row) => `${identifier(row.schema)}.${identifier(row.name)}`;
export function reviewEnvelope(sql) {
  // Même un client qui continue après une erreur ne peut exécuter ce contenu.
  let delimiter = '$breakery_review_only$';
  while (sql.includes(delimiter)) delimiter = delimiter.slice(0,-1) + '_$';
  return '-- REVUE SEULEMENT : ce SELECT retourne du texte et ne crée aucun objet.\n' +
    `SELECT ${delimiter}\n${sql}${delimiter} AS unapproved_sql;\n`;
}
const standardRoles = ['PUBLIC', 'anon', 'authenticated', 'service_role'];
const privilege = { a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE',
  x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE', U: 'USAGE', C: 'CREATE' };

export function aclEntries(acl) {
  if (acl == null) throw new Error('ACL implicite : préciser le défaut de cet objet.');
  if (acl === '{}') return [];
  if (!acl.startsWith('{') || !acl.endsWith('}')) throw new Error('ACL invalide.');
  return acl.slice(1, -1).split(',').map((entry) => {
    const match = /^([a-zA-Z_][a-zA-Z_0-9]*|)=([arwdDxtmXUC*]*)\/([a-zA-Z_][a-zA-Z_0-9]*)$/.exec(entry);
    if (!match) throw new Error('ACL non prise en charge : revue manuelle requise.');
    const permissions = [];
    for (let i=0; i<match[2].length; i++) {
      const code = match[2][i];
      if (!privilege[code]) throw new Error('Privilège non pris en charge.');
      const grantOption = match[2][i+1] === '*';
      permissions.push({ name: privilege[code], grantOption });
      if (grantOption) i++;
    }
    return { role: match[1] || 'PUBLIC', grantor: match[3], permissions };
  });
}

function roleSql(role) { return role === 'PUBLIC' ? 'PUBLIC' : identifier(role); }
function grants(kind, object, acl, owner, column = null) {
  // Les objets neufs héritent des ACL Supabase : les neutraliser avant restauration.
  const implicit = { FUNCTION: `=X/${owner}`, PROCEDURE: `=X/${owner}`, TYPE: `=U/${owner}` };
  const entries = aclEntries(acl ?? `{${implicit[kind] ?? ''}}`);
  if (entries.some((entry) => entry.grantor !== owner)) throw new Error(`Grantor différent du propriétaire : ${object}`);
  const roles = [...new Set([...standardRoles, owner, ...entries.map((entry) => entry.role)])];
  const col = column ? ` (${identifier(column)})` : '';
  const lines = [`REVOKE ALL PRIVILEGES${col} ON ${kind} ${object} FROM ${roles.map(roleSql).join(', ')};`];
  // Le propriétaire conserve les droits implicites ; restituer aussi ses ACL explicites.
  for (const entry of entries) for (const p of entry.permissions)
    lines.push(`GRANT ${p.name}${col} ON ${kind} ${object} TO ${roleSql(entry.role)}${p.grantOption ? ' WITH GRANT OPTION' : ''};`);
  return lines;
}

export function orderViews(views, dependencies) {
  const remaining = new Map(views.map((view) => [view.oid, view]));
  const result = [];
  while (remaining.size) {
    const next = [...remaining.values()].find((view) => !dependencies.some((dep) => dep.dependent === view.oid && remaining.has(dep.dependency)));
    if (!next) throw new Error('Cycle de dépendances entre vues.');
    result.push(next); remaining.delete(next.oid);
  }
  return result;
}

function columnSql(column) {
  if (column.identity) throw new Error('Colonne identity : restitution non prise en charge.');
  return `${identifier(column.name)} ${column.type}${column.collation ? ` COLLATE ${column.collation}` : ''}` +
    (column.generated ? ` GENERATED ALWAYS AS (${column.default}) STORED` : '') +
    (column.not_null ? ' NOT NULL' : '');
}
const statement = (definition) => definition.trim().replace(/;$/, '') + ';';
const comment = (kind, name, value) => value == null ? [] : [`COMMENT ON ${kind} ${name} IS ${literal(value)};`];
const tableKind = (row) => row.kind === 'm' ? 'MATERIALIZED VIEW' : row.kind === 'v' ? 'VIEW' : 'TABLE';

export function renderSchema(snapshot) {
  const { relations, functions, types, sequences, constraints, indexes } = snapshot;
  if (snapshot.unsupported.length) throw new Error('Objets non pris en charge présents.');
  if (constraints.some((c) => !Number.isSafeInteger(c.parent_id))) throw new Error('Identifiant de contrainte non numérique.');
  if (snapshot.view_dependencies.some((d) => !Number.isSafeInteger(d.dependent) || !Number.isSafeInteger(d.dependency))) throw new Error('Dépendance de vue non numérique.');
  if (types.some((type) => type.kind !== 'e')) throw new Error('Type non enum : revue requise.');
  if (relations.some((row) => !['r','p','v','m'].includes(row.kind))) throw new Error('Relation non prise en charge.');
  if (functions.some((row) => row.parsed_body)) throw new Error('Corps SQL préanalysé : ordre à résoudre.');
  if ([...relations,...functions,...types,...sequences].some((row) => row.owner !== 'postgres')) throw new Error('Propriétaire applicatif non pris en charge.');
  if (indexes.some((index) => !index.valid)) throw new Error('Index invalide dans la source.');
  const lines = [
    '-- EXTRACTION DE REVUE — NON APPROUVÉE POUR EXÉCUTION.',
    `-- Source Git : ${snapshot.sourceSha}. Source DB : ${snapshot.source}. Cible prévue : ${snapshot.target}.`,
    '-- Aucun contenu métier, état de séquence, secret, compte ou cron actif inclus.',
    '-- Le verrou ci-dessous doit rester en place jusqu’à validation du lot exécutable.',
    "DO $review$ BEGIN RAISE EXCEPTION 'review_only_not_approved_for_execution'; END $review$;",
    "SET check_function_bodies = false;",
    "SET search_path = public, extensions, pg_catalog;",
    "SET timezone = 'Asia/Makassar';",
    "ALTER DATABASE postgres SET timezone TO 'Asia/Makassar';",
  ];
  const section = (name) => lines.push(`\n-- ${name}`);
  section('Rôles techniques applicatifs, sans droits de connexion ni héritage');
  for (const role of snapshot.deployment_roles ?? []) {
    if (role.name !== 'kiosk_display' || role.superuser || role.create_role || role.create_db
      || role.login || role.inherit || role.bypass_rls || Number(role.parent_roles) !== 0)
      throw new Error('Rôle technique inattendu : revue de sécurité requise.');
    lines.push('CREATE ROLE kiosk_display NOLOGIN NOINHERIT NOBYPASSRLS;', 'GRANT kiosk_display TO authenticator;');
  }
  section('Extensions applicatives ; les extensions gérées sont vérifiées séparément');
  for (const extension of snapshot.context[0].extensions.filter((e) => ['btree_gist','pg_trgm','pgcrypto','uuid-ossp','pg_cron','pg_net'].includes(e.name)))
    lines.push(`CREATE EXTENSION IF NOT EXISTS ${identifier(extension.name)} WITH SCHEMA ${identifier(extension.schema)};`);
  section('Schémas et types');
  lines.push('CREATE SCHEMA stock_private AUTHORIZATION postgres;');
  for (const schema of snapshot.schemas) lines.push(...grants('SCHEMA', identifier(schema.name), schema.acl, schema.owner));
  for (const type of types) {
    lines.push(`CREATE TYPE ${qualified(type)} AS ENUM (${type.labels.map(literal).join(', ')});`);
    lines.push(...comment('TYPE', qualified(type), type.comment));
  }
  section('Séquences neuves ; aucun last_value de développement');
  for (const seq of sequences) {
    if (seq.dependency === 'i') throw new Error('Séquence identity non prise en charge.');
    lines.push(`CREATE SEQUENCE ${qualified(seq)} AS ${seq.type} INCREMENT BY ${seq.increment} MINVALUE ${seq.min} MAXVALUE ${seq.max} START WITH ${seq.start} CACHE ${seq.cache}${seq.cycle ? ' CYCLE' : ' NO CYCLE'};`);
  }
  section('Tables puis partitions');
  const tables = relations.filter((row) => ['r','p'].includes(row.kind));
  for (const table of tables.filter((row) => !row.is_partition)) {
    if (table.parents?.length) throw new Error('Héritage classique non pris en charge.');
    lines.push(`CREATE ${table.persistence === 'u' ? 'UNLOGGED ' : ''}TABLE ${qualified(table)} (\n  ${table.columns.map(columnSql).join(',\n  ')}\n)${table.partition_key ? ` PARTITION BY ${table.partition_key}` : ''}${table.options?.length ? ` WITH (${table.options.join(', ')})` : ''};`);
  }
  for (const table of tables.filter((row) => row.is_partition)) {
    if (table.parents?.length !== 1 || table.partition_key) throw new Error('Partition imbriquée non prise en charge.');
    lines.push(`CREATE TABLE ${qualified(table)} PARTITION OF ${table.parents[0]} ${table.partition_bound};`);
  }
  section('Fonctions : corps live intégraux, sans réécriture');
  for (const fn of functions) {
    lines.push(statement(fn.definition));
    lines.push(...comment(fn.kind === 'p' ? 'PROCEDURE' : 'FUNCTION', `${qualified(fn)}(${fn.arguments})`, fn.comment));
  }
  section('Valeurs par défaut et ownership des séquences');
  for (const table of tables) for (const col of table.columns)
    if (col.default && !col.generated) lines.push(`ALTER TABLE ONLY ${qualified(table)} ALTER COLUMN ${identifier(col.name)} SET DEFAULT ${col.default};`);
  for (const seq of sequences) if (seq.owned_table)
    lines.push(`ALTER SEQUENCE ${qualified(seq)} OWNED BY ${seq.owned_table}.${identifier(seq.owned_column)};`);
  section('Contraintes hors FK ; les contraintes de triggers sont restituées avec leurs triggers');
  const ownConstraints = constraints.filter((c) => c.parent_id === 0 && c.is_local && c.kind !== 't');
  for (const constraint of ownConstraints.filter((c) => c.kind !== 'f'))
    lines.push(`ALTER TABLE ${constraint.relation} ADD CONSTRAINT ${identifier(constraint.name)} ${constraint.definition};`);
  section('Vues et vues matérialisées ; ces dernières sont initialement vides');
  for (const view of orderViews(relations.filter((row) => ['v','m'].includes(row.kind)), snapshot.view_dependencies))
    lines.push(`CREATE ${tableKind(view)} ${qualified(view)}${view.options?.length ? ` WITH (${view.options.join(', ')})` : ''} AS\n${view.definition.trim().replace(/;$/, '')}${view.kind === 'm' ? '\nWITH NO DATA' : ''};`);
  section('Index indépendants puis rattachements de partitions');
  for (const index of indexes.filter((row) => !row.constraint_owned)) lines.push(statement(index.definition));
  for (const index of indexes.filter((row) => !row.constraint_owned && row.parent))
    lines.push(`ALTER INDEX ${index.parent} ATTACH PARTITION ${index.name};`);
  section('Clés étrangères');
  for (const constraint of ownConstraints.filter((c) => c.kind === 'f'))
    lines.push(`ALTER TABLE ${constraint.relation} ADD CONSTRAINT ${identifier(constraint.name)} ${constraint.definition};`);
  section('Déclencheurs et leur état');
  for (const trigger of snapshot.triggers) {
    lines.push(statement(trigger.definition));
    const state = { O:'ENABLE', D:'DISABLE', R:'ENABLE REPLICA', A:'ENABLE ALWAYS' }[trigger.enabled];
    if (!state) throw new Error('État de trigger inconnu.');
    lines.push(`ALTER TABLE ${identifier(trigger.schema)}.${identifier(trigger.relation)} ${state} TRIGGER ${identifier(trigger.name)};`);
  }
  section('Politiques de sécurité et RLS');
  for (const policy of snapshot.policies)
    lines.push(`CREATE POLICY ${identifier(policy.name)} ON ${identifier(policy.schema)}.${identifier(policy.relation)} AS ${policy.permissive} FOR ${policy.cmd} TO ${policy.roles.map((role) => role === 'public' ? 'PUBLIC' : identifier(role)).join(', ')}${policy.qual ? ` USING (${policy.qual})` : ''}${policy.with_check ? ` WITH CHECK (${policy.with_check})` : ''};`);
  for (const table of tables) {
    if (table.rls) lines.push(`ALTER TABLE ${qualified(table)} ENABLE ROW LEVEL SECURITY;`);
    if (table.force_rls) lines.push(`ALTER TABLE ${qualified(table)} FORCE ROW LEVEL SECURITY;`);
    if (table.replica_identity === 'f') lines.push(`ALTER TABLE ${qualified(table)} REPLICA IDENTITY FULL;`);
    else if (table.replica_identity === 'n') lines.push(`ALTER TABLE ${qualified(table)} REPLICA IDENTITY NOTHING;`);
  }
  for (const index of indexes.filter((row) => row.replica_identity))
    lines.push(`ALTER TABLE ${index.relation} REPLICA IDENTITY USING INDEX ${index.name.split('.').at(-1)};`);
  section('ACL explicites, y compris les droits colonne par colonne');
  for (const table of relations) {
    lines.push(...grants('TABLE', qualified(table), table.acl, table.owner));
    for (const col of table.columns) if (col.acl) lines.push(...grants('TABLE', qualified(table), col.acl, table.owner, col.name));
    lines.push(...comment(tableKind(table), qualified(table), table.comment));
    for (const col of table.columns) lines.push(...comment('COLUMN', `${qualified(table)}.${identifier(col.name)}`, col.comment));
  }
  for (const seq of sequences) lines.push(...grants('SEQUENCE', qualified(seq), seq.acl, seq.owner));
  for (const type of types) lines.push(...grants('TYPE', qualified(type), type.acl, type.owner));
  for (const fn of functions) lines.push(...grants(fn.kind === 'p' ? 'PROCEDURE' : 'FUNCTION', `${qualified(fn)}(${fn.arguments})`, fn.acl, fn.owner));
  section('Privilèges par défaut de postgres');
  for (const entry of snapshot.defaults) {
    const kind = { r:'TABLES', S:'SEQUENCES', f:'FUNCTIONS', T:'TYPES' }[entry.kind];
    if (!kind) throw new Error('Type de privilège par défaut inconnu.');
    const prefix = `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(entry.owner)}${entry.schema ? ` IN SCHEMA ${identifier(entry.schema)}` : ''}`;
    const entries = aclEntries(entry.acl);
    const roles = [...new Set([...standardRoles, entry.owner, ...entries.map((e) => e.role)])];
    lines.push(`${prefix} REVOKE ALL PRIVILEGES ON ${kind} FROM ${roles.map(roleSql).join(', ')};`);
    for (const acl of entries) for (const p of acl.permissions)
      lines.push(`${prefix} GRANT ${p.name} ON ${kind} TO ${roleSql(acl.role)}${p.grantOption ? ' WITH GRANT OPTION' : ''};`);
  }
  section('Realtime : publication Supabase existante, tables applicatives seulement');
  for (const pub of snapshot.publications) {
    if (pub.all_tables) throw new Error('Publication globale non prise en charge.');
    if (pub.tables?.some((t) => !['public','stock_private'].includes(t.schema) || t.filter)) throw new Error('Publication filtrée ou extérieure non prise en charge.');
    for (const table of pub.tables ?? [])
      lines.push(`ALTER PUBLICATION ${identifier(pub.name)} ADD TABLE ${identifier(table.schema)}.${identifier(table.table)} (${table.columns.map(identifier).join(', ')});`);
  }
  lines.push('RESET check_function_bodies;');
  return reviewEnvelope(lines.join('\n') + '\n');
}

export function renderChecks(snapshot) {
  const tables = snapshot.relations.filter((r) => ['r','p'].includes(r.kind)).length;
  return `-- Contrôles en lecture seule après une future initialisation approuvée.\n` +
    `-- Des résultats attendus ne remplacent pas pgTAP, le test de connexion et le parcours de vente.\n` +
    `SELECT current_setting('TimeZone') = 'Asia/Makassar' AS timezone_ok;\n` +
    `SELECT count(*) = ${tables} AS table_count_ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','stock_private') AND c.relkind IN ('r','p');\n` +
    `SELECT count(*) = ${snapshot.functions.length} AS function_count_ok FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','stock_private') AND p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');\n` +
    `SELECT count(*) = ${snapshot.policies.length} AS policy_count_ok FROM pg_policies WHERE schemaname IN ('public','stock_private','storage');\n` +
    `SELECT c.relname, c.relrowsecurity, NOT has_table_privilege('authenticated',c.oid,'UPDATE') AS client_update_revoked, NOT has_table_privilege('authenticated',c.oid,'DELETE') AS client_delete_revoked FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('stock_movements','audit_logs');\n` +
    `SELECT p.oid::regprocedure AS anonymous_callable,obj_description(p.oid,'pg_proc') AS justification FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','stock_private') AND has_function_privilege('anon',p.oid,'EXECUTE') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e');\n` +
    `SELECT schemaname,tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1,2;\n` +
    `SELECT matviewname,ispopulated FROM pg_matviews WHERE schemaname='public' ORDER BY 1;\n`;
}
