// Extraction en lecture seule. Aucun secret Vault ni ligne métier n'est lu.
export const SOURCE = 'ikcyvlovptebroadgtvd';
export const TARGET = 'yjhhhmjgsmyzyymvixot';
export const SCHEMAS = ['public', 'stock_private'];
const app = "n.nspname in ('public','stock_private')";
const nonExtension = (catalog, alias) => `not exists (select 1 from pg_depend d where d.classid='${catalog}'::regclass and d.objid=${alias}.oid and d.deptype='e')`;
export const queries = {
  deployment_roles: `select rolname as name,rolsuper as superuser,rolcreaterole as create_role,
    rolcreatedb as create_db,rolcanlogin as login,rolinherit as inherit,rolbypassrls as bypass_rls,
    (select count(*) from pg_auth_members m where m.member=r.oid) as parent_roles
    from pg_roles r where rolname='kiosk_display'`,
  context: `select current_setting('server_version') as server_version, current_setting('TimeZone') as timezone,
    current_timestamp as captured_at, (select json_agg(json_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) order by e.extname)
    from pg_extension e join pg_namespace n on n.oid=e.extnamespace) as extensions`,
  schemas: `select n.nspname as name, pg_get_userbyid(n.nspowner) as owner, n.nspacl::text as acl
    from pg_namespace n where ${app} order by 1`,
  types: `select n.nspname as schema,t.typname as name,t.typtype as kind,pg_get_userbyid(t.typowner) as owner,
    t.typacl::text as acl,obj_description(t.oid,'pg_type') as comment,
    (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) as labels,
    (select json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) order by a.attnum)
      from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped) as attributes
    from pg_type t join pg_namespace n on n.oid=t.typnamespace left join pg_class c on c.oid=t.typrelid
    where ${app} and ${nonExtension('pg_type','t')} and (t.typtype='e' or c.relkind='c' or t.typtype='d') order by 1,2`,
  relations: `select c.oid::bigint as oid,n.nspname as schema,c.relname as name,c.relkind as kind,pg_get_userbyid(c.relowner) as owner,
    c.relacl::text as acl,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,c.relreplident as replica_identity,
    c.relpersistence as persistence,c.reloptions as options,c.relispartition as is_partition,
    pg_get_expr(c.relpartbound,c.oid) as partition_bound,pg_get_partkeydef(c.oid) as partition_key,
    (select json_agg(i.inhparent::regclass::text order by i.inhseqno) from pg_inherits i where i.inhrelid=c.oid) as parents,
    case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,true) end as definition,
    obj_description(c.oid,'pg_class') as comment,
    (select json_agg(json_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
      'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
      'default',pg_get_expr(ad.adbin,ad.adrelid),'acl',a.attacl::text,'comment',col_description(c.oid,a.attnum),
      'collation',case when a.attcollation<>t.typcollation then a.attcollation::regcollation::text end) order by a.attnum)
      from pg_attribute a join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
      where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where ${app} and ${nonExtension('pg_class','c')} and c.relkind in ('r','p','v','m','f') order by 1`,
  sequences: `select n.nspname as schema,c.relname as name,pg_get_userbyid(c.relowner) as owner,c.relacl::text as acl,
    format_type(s.seqtypid,null) as type,s.seqstart::text as start,s.seqincrement::text as increment,
    s.seqmin::text as min,s.seqmax::text as max,s.seqcache::text as cache,s.seqcycle as cycle,
    d.deptype as dependency, case when d.refobjid is not null then d.refobjid::regclass::text end as owned_table,
    a.attname as owned_column,obj_description(c.oid,'pg_class') as comment
    from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid and d.refclassid='pg_class'::regclass and d.deptype in ('a','i')
    left join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid where ${app} order by 1,2`,
  constraints: `select con.oid::bigint as oid,con.conrelid::regclass::text as relation,con.conname as name,con.contype as kind,
    pg_get_constraintdef(con.oid,true) as definition,con.conparentid::bigint as parent_id,con.conislocal as is_local,
    obj_description(con.oid,'pg_constraint') as comment
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where ${app} order by con.contype,con.conrelid,con.conname`,
  indexes: `select i.indexrelid::regclass::text as name,i.indrelid::regclass::text as relation,
    pg_get_indexdef(i.indexrelid) as definition,i.indisreplident as replica_identity,i.indisvalid as valid,
    (select inhparent::regclass::text from pg_inherits where inhrelid=i.indexrelid) as parent,
    exists(select 1 from pg_constraint con where con.conindid=i.indexrelid and con.contype in ('p','u','x')) as constraint_owned
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where ${app} order by i.indexrelid`,
  triggers: `select n.nspname as schema,c.relname as relation,t.tgname as name,t.tgenabled as enabled,
    pg_get_triggerdef(t.oid,true) as definition,obj_description(t.oid,'pg_trigger') as comment
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
    where not t.tgisinternal and t.tgparentid=0 and (${app} or (n.nspname in ('auth','storage') and pn.nspname in ('public','stock_private')))
    order by 1,2,3`,
  policies: `select schemaname as schema,tablename as relation,policyname as name,permissive,to_json(roles) as roles,cmd,qual,with_check
    from pg_policies where schemaname in ('public','stock_private','storage') order by 1,2,3`,
  view_dependencies: `select distinct c.oid::bigint as dependent,ref.oid::bigint as dependency
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace
    join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=r.oid and d.refclassid='pg_class'::regclass
    join pg_class ref on ref.oid=d.refobjid
    where ${app} and c.relkind in ('v','m') and ref.relkind in ('v','m') and ref.oid<>c.oid`,
  defaults: `select pg_get_userbyid(d.defaclrole) as owner,n.nspname as schema,d.defaclobjtype as kind,d.defaclacl::text as acl
    from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
    where pg_get_userbyid(d.defaclrole)='postgres' and (n.nspname in ('public','stock_private') or d.defaclnamespace=0) order by 1,2,3`,
  publications: `select p.pubname as name,p.puballtables as all_tables,p.pubinsert,p.pubupdate,p.pubdelete,p.pubtruncate,
    (select json_agg(json_build_object('schema',t.schemaname,'table',t.tablename,'columns',t.attnames,'filter',t.rowfilter)
     order by t.schemaname,t.tablename) from pg_publication_tables t where t.pubname=p.pubname) as tables
    from pg_publication p where p.pubname='supabase_realtime'`,
  buckets: `select id,name,public,file_size_limit,allowed_mime_types from storage.buckets order by id`,
  cron: `select jobname,schedule,active,
    position('ikcyvlovptebroadgtvd' in command)>0 as targets_dev,
    position('net.http_post' in command)>0 as calls_http,
    md5(command) as command_fingerprint from cron.job order by jobname`,
  unsupported: `select 'rule' as kind,n.nspname as schema,c.relname as relation,r.rulename as name
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace
    where ${app} and r.rulename<>'_RETURN'
    union all select 'event_trigger',null,null,evtname from pg_event_trigger where evtowner=(select oid from pg_roles where rolname='postgres')`,
};

export function functionsPage(offset, limit = 4) {
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>10) throw new Error('Pagination invalide.');
  return `select p.oid::bigint as oid,n.nspname as schema,p.proname as name,p.prokind as kind,
    pg_get_function_identity_arguments(p.oid) as arguments,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl,
    p.prosecdef as security_definer,p.prosqlbody is not null as parsed_body,
    pg_get_functiondef(p.oid) as definition,obj_description(p.oid,'pg_proc') as comment
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${app} and ${nonExtension('pg_proc','p')}
    and p.prokind in ('f','p') order by p.oid limit ${limit} offset ${offset}`;
}

// Une seule instruction SELECT : toutes les catégories partagent le snapshot MVCC.
export function snapshotQuery() {
  const categories = { ...queries, functions:functionsPage(0,10).replace(/ limit 10 offset 0$/, '') };
  return 'select json_build_object(\n' + Object.entries(categories).map(([name,query]) =>
    `  '${name}', (select coalesce(json_agg(category), '[]'::json) from (${query}) category)`
  ).join(',\n') + '\n) as snapshot';
}
