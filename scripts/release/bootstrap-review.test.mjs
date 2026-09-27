import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aclEntries, identifier, literal, orderViews, renderSchema, renderChecks, reviewEnvelope } from './bootstrap-render.mjs';
import { functionsPage, queries, snapshotQuery } from './bootstrap-catalog.mjs';
import { inspectContracts, insertReview, compareEdge } from './bootstrap-review.mjs';

function fixture() {
  return {source:'dev',target:'prod',sourceSha:'a'.repeat(40),context:[{extensions:[]}],
    schemas:[{name:'public',owner:'pg_database_owner',acl:'{pg_database_owner=UC/pg_database_owner,=U/pg_database_owner}'},
      {name:'stock_private',owner:'postgres',acl:'{postgres=UC/postgres}'}],
    types:[],sequences:[],constraints:[],indexes:[],functions:[],triggers:[],policies:[],defaults:[],publications:[],view_dependencies:[],unsupported:[],
    relations:[{oid:1,schema:'public',name:'profiles',kind:'r',owner:'postgres',acl:'{postgres=arwdDxtm/postgres}',
      columns:[{name:'id',type:'uuid',not_null:true,default:'gen_random_uuid()'},
        {name:'name',type:'text',acl:'{authenticated=r/postgres}'},{name:'pin_hash',type:'text'}]}]};
}

test('ACL : PUBLIC implicite, MAINTAIN et grant option restent distincts', () => {
  const entries=aclEntries('{=X/postgres,authenticated=r*w/postgres,postgres=m/postgres}');
  assert.equal(entries[0].role,'PUBLIC');
  assert.deepEqual(entries[1].permissions,[{name:'SELECT',grantOption:true},{name:'UPDATE',grantOption:false}]);
  assert.equal(entries[2].permissions[0].name,'MAINTAIN');
  assert.throws(()=>aclEntries('{unexpected-role=X/postgres}'),/revue manuelle/);
  assert.throws(()=>aclEntries(null),/implicite/);
});

test('identifiants et valeurs SQL ne peuvent fermer leur quoting', () => {
  assert.equal(identifier('a"b'),'"a""b"');
  assert.equal(literal("l'hiver"),"'l''hiver'");
  assert.equal(literal(null),'NULL');
  assert.match(insertReview('units',[{code:"x');DROP TABLE y;--",is_active:false}]),/'x''\);DROP TABLE y;--', FALSE/);
});

test('le rôle écran précède les ACL et refuse tout privilège inattendu', () => {
  const snapshot = fixture();
  snapshot.deployment_roles = [{name:'kiosk_display',parent_roles:0}];
  const sql = renderSchema(snapshot);
  assert.match(sql,/CREATE ROLE kiosk_display NOLOGIN NOINHERIT NOBYPASSRLS/);
  assert.ok(sql.indexOf('CREATE ROLE kiosk_display') < sql.indexOf('-- Schémas'));
  snapshot.deployment_roles[0].login = true;
  assert.throws(() => renderSchema(snapshot), /Rôle technique inattendu/);
});

test('les colonnes publiques du profil ne donnent aucun accès au hash du PIN', () => {
  const sql=renderSchema(fixture());
  assert.match(sql,/GRANT SELECT \("name"\) ON TABLE "public"\."profiles" TO "authenticated"/);
  assert.doesNotMatch(sql,/GRANT SELECT(?: \("pin_hash"\))? ON TABLE "public"\."profiles" TO "authenticated"/);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON TABLE "public"\."profiles" FROM PUBLIC, "anon", "authenticated", "service_role", "postgres"/);
});

test('les fonctions service_role ne récupèrent pas EXECUTE via PUBLIC', () => {
  const s=fixture();
  s.functions=[{schema:'public',name:'refund',kind:'f',owner:'postgres',arguments:'p_id uuid',
    acl:'{postgres=X/postgres,service_role=X/postgres}',definition:'CREATE FUNCTION public.refund(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;'}];
  const sql=renderSchema(s);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON FUNCTION "public"\."refund"\(p_id uuid\) FROM PUBLIC, "anon", "authenticated", "service_role", "postgres"/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION "public"\."refund"\(p_id uuid\) TO "service_role"/);
  assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION .* TO (?:PUBLIC|"anon"|"authenticated")/);
});

test('le verrou de revue précède toute mutation et les defaults suivent les fonctions', () => {
  const s=fixture();
  const sql=renderSchema(s);
  assert.ok(sql.indexOf("RAISE EXCEPTION 'review_only")<sql.indexOf('ALTER DATABASE'));
  assert.ok(sql.indexOf('-- Fonctions')<sql.indexOf('SET DEFAULT gen_random_uuid()'));
  assert.doesNotMatch(sql,/INSERT INTO|setval\(|cron\.schedule/);
});

test('le SQL de revue reste du texte même si le client poursuit après une erreur', () => {
  const sql=renderSchema(fixture());
  const delimiter=sql.match(/SELECT (\$[^$]+\$)/)[1];
  const pieces=sql.split(delimiter);
  assert.equal(pieces.length,3);
  assert.match(pieces[0],/SELECT $/);
  assert.equal(pieces[2],' AS unapproved_sql;\n');
  assert.match(pieces[1],/ALTER DATABASE/);
  const collision=reviewEnvelope('SELECT $breakery_review_only$;');
  assert.match(collision,/SELECT \$breakery_review_only_\$/);
});

test('vues : dépendances ordonnées et cycle refusé', () => {
  const views=[{oid:2},{oid:1}];
  assert.deepEqual(orderViews(views,[{dependent:2,dependency:1}]).map(v=>v.oid),[1,2]);
  assert.throws(()=>orderViews(views,[{dependent:1,dependency:2},{dependent:2,dependency:1}]),/Cycle/);
});

test('un objet non pris en charge ne devient pas une omission silencieuse', () => {
  const cases=[s=>s.unsupported.push({kind:'rule'}),s=>s.relations[0].kind='f',
    s=>s.relations[0].columns[0].identity='a',s=>s.indexes.push({valid:false}),
    s=>s.types.push({kind:'d'}),s=>s.functions.push({parsed_body:true}),
    s=>s.constraints.push({parent_id:'0'}),s=>s.view_dependencies.push({dependent:'1',dependency:'2'})];
  for(const mutate of cases){const s=fixture();mutate(s);assert.throws(()=>renderSchema(s));}
});

test('les requêtes ne lisent ni lignes métier, ni secret Vault, ni état de séquence', () => {
  for(const query of [...Object.values(queries),functionsPage(0)]) {
    assert.match(query,/^select /);
    assert.doesNotMatch(query,/\b(?:insert|update|delete|alter|drop|truncate|create|copy)\s/i);
    assert.doesNotMatch(query,/vault\.decrypted_secrets|auth\.users|public\.orders|last_value|pin_hash/i);
  }
  assert.throws(()=>functionsPage(-1));
  assert.throws(()=>functionsPage(0,100));
});

test('les contrôles post-initialisation ne mutent pas la base', () => {
  const sql=renderChecks(fixture());
  assert.doesNotMatch(sql,/\b(?:INSERT INTO|UPDATE public|DELETE FROM|CREATE |ALTER |DROP |TRUNCATE |DO \$)/);
  assert.match(sql,/has_function_privilege\('anon'/);
  assert.match(sql,/client_update_revoked/);
});

test('le snapshot couvre toutes les catégories dans une seule instruction sans pagination', () => {
  const sql=snapshotQuery();
  assert.match(sql,/^select json_build_object/);
  assert.doesNotMatch(sql,/\blimit\b|\boffset\b/i);
  for(const name of [...Object.keys(queries),'functions']) assert.ok(sql.includes(`'${name}', (select`));
  assert.ok(sql.length<12000);
});

test('un consommateur RPC manquant est signalé avec son emplacement', () => {
  const result=inspectContracts({functions:[{name:'exists'}]},[{path:'consumer.ts',content:"client.rpc('exists');\nclient.rpc('absent');"}],
    [{code:'a.read'}],"export type PermissionCode =\n | 'a.read'\n | 'b.read';");
  assert.deepEqual(result.missingRpc,[{name:'absent',file:'consumer.ts',line:2}]);
  assert.deepEqual(result.permissionCodesOnlyInSource,['b.read']);
});

test('EF : différences de code et JWT, mais pas de faux écart CRLF', () => {
  const root=mkdtempSync(join(tmpdir(),'bootstrap-review-'));
  try {
    mkdirSync(join(root,'supabase/functions/example'),{recursive:true});
    writeFileSync(join(root,'supabase/functions/example/index.ts'),'serve();\n');
    const live=[{slug:'example',version:2,verify_jwt:false,files:[{name:'example/index.ts',content:'serve();\r\n'}]}];
    const result=compareEdge(root,live,'[functions.example]\n# Authentification contrôlée\nverify_jwt = true');
    assert.equal(result[0].configurationStatus,'divergence');
    assert.equal(result[0].files[0].equalIgnoringLineEndings,true);
    live[0].files[0].content='changed();\n';
    assert.equal(compareEdge(root,live,'')[0].files[0].equalIgnoringLineEndings,false);
    live[0].files[0].name='example/../../../../outside.ts';
    assert.throws(()=>compareEdge(root,live,''),/périmètre/);
  } finally {rmSync(root,{recursive:true,force:true});}
});
