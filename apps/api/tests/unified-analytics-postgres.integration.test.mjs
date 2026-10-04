import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {AnalyticsService} from '../dist/review/analytics.service.js';
const integration = process.env.DATABASE_URL ? test : test.skip;
integration('grouped analytics uses recorded code labels without needing a filter', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const fixture = (await client.query(`select r.organization_id,r.documenting_user_id,p.reporting_date::text,o.code,o.code_display
    from clinical.report r join analytics.review_volume_source p on p.report_id=r.id
    join clinical.element_occurrence o on o.report_id=r.id and o.element_id='eDispatch.05'
    where r.status='signed' and r.synthetic and (r.expires_at is null or r.expires_at>now())
      and o.tombstoned_at is null and o.code_display is not null and o.code_display<>o.code limit 1`)).rows[0];
  assert.ok(fixture, 'project a signed local synthetic fixture with labeled dispatch priority before integration tests');
  const session = { user: { id: fixture.documenting_user_id }, organization: { id: fixture.organization_id },
    capabilities: ['review:all', 'clinical:demo'] };
  const manager = { query: async (sql, params) => sql.includes('projection_health') ? [{ observed_at: new Date(),
    oldest_backlog_age_seconds: null, persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
    last_run_status: 'succeeded', is_read_only_replica: false, replay_lag_seconds: null }] : (await client.query(sql, params)).rows };
  const database = { ...manager, transaction: async (_level, run) => run(manager) };
  const service = new AnalyticsService(database, { get: async () => session }, { analyticsDatabase: async () => database });
  await client.query('set local role open_triage_api_runtime');
  const definition = { version: 1, metric: 'records', aggregation: 'count', visualization: 'table',
    from: fixture.reporting_date, through: fixture.reporting_date, groupBy: 'eDispatch.05', timeGrouping: 'day', filters: [] };
  const result = await service.query('test', definition);
  const series = result.series.find(series => series.group?.value === fixture.code);
  assert.ok(series);
  assert.deepEqual(series.group, { type: 'code', value: fixture.code });
  assert.equal(series.groupLabel, fixture.code_display);
  assert.ok(result.cells.find(cell => cell.series === series.id).count > 0);
  const choices = await service.values('test', definition.groupBy);
  assert.equal(series.groupLabel, choices.items.find(choice => choice.identity.value === fixture.code).label);
  const csv = await service.export('test', { definition, kind: 'aggregate', expectedRevision: result.exportRevision });
  assert.ok(csv.includes(fixture.code_display));
  assert.ok(csv.includes(fixture.code));
});
integration('analytics users support scoped discovery, grouping, counts, labels and exports', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  const fixture = (await client.query(`select r.organization_id,r.documenting_user_id,p.reporting_date::text
    from clinical.report r join analytics.review_volume_source p on p.report_id=r.id
    where r.status='signed' and r.synthetic and (r.expires_at is null or r.expires_at>now()) limit 1`)).rows[0];
  assert.ok(fixture, 'project a signed local synthetic fixture before integration tests');
  let session = { user: { id: fixture.documenting_user_id }, organization: { id: fixture.organization_id },
    capabilities: ['review:all', 'clinical:demo', 'review:identifying'] };
  const manager = { query: async (sql, params) => sql.includes('projection_health') ? [{ observed_at: new Date(),
    oldest_backlog_age_seconds: null, persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
    last_run_status: 'succeeded', is_read_only_replica: false, replay_lag_seconds: null }] : (await client.query(sql, params)).rows };
  const database = { ...manager, transaction: async (_level, run) => run(manager) };
  const service = new AnalyticsService(database, { get: async () => session }, { analyticsDatabase: async () => database });
  await client.query('set local role open_triage_api_runtime');
  const element = 'record.documenting-user';
  for (const purpose of ['group', 'filter']) assert.equal((await service.elements('test', 'User', '1', purpose)).items.find(row => row.id === element)?.label, 'User');
  assert.ok(!(await service.elements('test', 'User', '1', 'metric')).items.some(row => row.id === element));
  const users = await service.values('test', element);
  const selected = users.items.find(row => row.identity.value === fixture.documenting_user_id);
  assert.ok(selected);
  const expected = (await client.query(`select u.display_name,count(*)::integer count
    from clinical.report r join app_identity.app_user u on u.id=r.documenting_user_id and u.organization_id=r.organization_id
    where r.organization_id=$1 and r.synthetic and r.documenting_user_id=$2 and (r.expires_at is null or r.expires_at>now())
    group by u.display_name`, [fixture.organization_id, fixture.documenting_user_id])).rows[0];
  assert.equal(selected.label, expected.display_name);
  assert.equal(selected.recordCount, expected.count);
  assert.ok((await service.values('test', element, selected.label)).items.some(row => row.identity.value === selected.identity.value));
  assert.ok((await service.values('test', element, selected.identity.value)).items.some(row => row.identity.value === selected.identity.value));
  const beyond = await service.values('test', element, '', '999999');
  assert.equal(beyond.total, users.total); assert.deepEqual(beyond.items, []);
  const definition = { version: 1, metric: 'records', aggregation: 'count', visualization: 'table',
    from: fixture.reporting_date, through: fixture.reporting_date, groupBy: element, timeGrouping: 'day',
    filters: [{ element, values: [selected.identity] }] };
  const result = await service.query('test', definition);
  assert.ok(result.completeness.valid > 0);
  assert.equal(result.series.length, 1);
  assert.deepEqual(result.series[0].group, selected.identity);
  assert.equal(result.series[0].groupLabel, selected.label);
  assert.equal(result.filters[0].values[0].label, selected.label);
  const counts = await service.counts('test', { definition, selection: { purpose: 'values', element, values: [selected.identity] } });
  assert.equal(counts.values[0].included, result.completeness.valid);
  const groupingCounts = await service.counts('test', { definition, selection: { purpose: 'group', ids: [element] } });
  assert.equal(groupingCounts.elements[0].included, result.completeness.valid);
  const csv = await service.export('test', { definition, kind: 'aggregate', expectedRevision: result.exportRevision });
  assert.ok(csv.includes(selected.identity.value)); assert.ok(csv.includes(selected.label));
  const empty = await service.query('test', { ...definition, from: '1900-01-01', through: '1900-01-01' });
  assert.equal(empty.completeness.valid, 0);
  assert.equal(empty.filters[0].values[0].label, selected.label, 'selected user labels survive empty date ranges');
  session = { ...session, capabilities: ['review:self', 'clinical:demo'] };
  const own = await service.values('test', element);
  assert.deepEqual(own.items.map(row => [row.identity.value, row.label]), [[fixture.documenting_user_id, fixture.documenting_user_id]]);
  const masked = await service.query('test', definition);
  assert.equal(masked.series[0].groupLabel, fixture.documenting_user_id);
  assert.equal(masked.filters[0].values[0].label, fixture.documenting_user_id);
  session = { ...session, user: { id: randomUUID() } };
  assert.ok(!(await service.elements('test', 'User', '1', 'filter')).items.some(row => row.id === element));
  await assert.rejects(service.values('test', element), /unavailable/);
  session = { ...session, capabilities: ['review:all', 'clinical:demo'], organization: { id: randomUUID() } };
  await assert.rejects(service.values('test', element), /unavailable/);
  session = { ...session, organization: { id: fixture.organization_id }, capabilities: ['review:all'] };
  const real = await service.elements('test', 'User', '1', 'filter');
  if (real.items.some(row => row.id === element)) {
    const choices = await service.values('test', element);
    const count = (await client.query(`select count(*)::integer count from clinical.report where organization_id=$1
      and not synthetic and documenting_user_id=$2 and (expires_at is null or expires_at>now())`, [fixture.organization_id, fixture.documenting_user_id])).rows[0].count;
    assert.equal(choices.items.find(row => row.identity.value === fixture.documenting_user_id)?.recordCount ?? 0, count);
  }
});
integration('unified analytics enforces scope, live draft/custom discovery, signed eligibility and export revisions',async t=>{
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
  t.after(async()=>{await client.query('rollback');await client.end();});await client.query('begin');
  const fixture=(await client.query(`select r.*,gi.id root_id,(select id from forms.form_section where form_version_id=r.form_version_id limit 1) section_id from clinical.report r
    join clinical.group_instance gi on gi.report_id=r.id and gi.group_id='PatientCareReportGroup' and gi.tombstoned_at is null
    where r.status='draft' and r.synthetic order by r.id limit 1`)).rows[0];
  assert.ok(fixture,'seed the local synthetic draft fixture before integration tests');
  const publicId=randomUUID(),privateId=randomUUID(),secondId=randomUUID();
  const definitions=[publicId,privateId,secondId].map((id,index)=>({id,namespace:'org.unifiedtest',slug:`field${id.replaceAll('-','')}`,
    title:'Same displayed label',datatype:'coded',recurrence:'multiple',identifying:index===1,retired:index===0,
    definition:`Meaning ${index}`,usage:'Optional',constraints:{}}));
  // This rollback-only fixture pins custom definitions exactly as authoring does.
  // Existing releases are immutable in production; restore the trigger immediately.
  await client.query('alter table catalog.release disable trigger catalog_release_immutable');
  await client.query(`update catalog.release set provenance=jsonb_set(provenance,'{customElementDefinitions}',
    coalesce(provenance->'customElementDefinitions','[]'::jsonb)||$2::jsonb) where id=$1`,[fixture.catalog_release_id,JSON.stringify(definitions)]);
  await client.query('alter table catalog.release enable trigger catalog_release_immutable');
  const occurrences=[];
  for(const definition of definitions){
    await client.query('insert into catalog.element_identity(id,namespace,canonical_key) values($1,$2,$3)',[definition.id,definition.namespace,`${definition.namespace}.${definition.slug}`]);
    await client.query(`insert into forms.custom_element_definition(id,organization_id,namespace,slug,title,base_datatype,identifying,definition)
      values($1,$2,$3,$4,$5,'coded',$6,$7)`,[definition.id,fixture.organization_id,definition.namespace,definition.slug,definition.title,definition.identifying,definition]);
    const fieldId=randomUUID();
    await client.query('alter table forms.form_field disable trigger form_field_immutable');
    await client.query(`insert into forms.form_field(id,form_version_id,section_id,stable_key,position,source_kind,custom_element_definition_id,analytical_repeatable)
      values($1,$2,$3,$4,(select coalesce(max(position),-1)+1 from forms.form_field where section_id=$3),'custom',$5,true)`,
      [fieldId,fixture.form_version_id,fixture.section_id,`unified-${definition.id}`,definition.id]);
    await client.query('alter table forms.form_field enable trigger form_field_immutable');
    for(let ordinal=0;ordinal<2;ordinal++){
      const id=randomUUID();occurrences.push(id);
      await client.query(`insert into clinical.element_occurrence(id,report_id,catalog_release_id,group_instance_id,
        element_identity_id,element_id,ordinal,analytical_repeatable,identifying,value_kind,code,code_display,author_id,form_field_id)
        values($1,$2,$3,$4,$5,$6,$7,true,$8,'coded','historical-draft','Historical draft value',$9,$10)`,
      [id,fixture.id,fixture.catalog_release_id,fixture.root_id,definition.id,`${definition.namespace}.${definition.slug}`,ordinal,definition.identifying,fixture.documenting_user_id,fieldId]);
    }
  }
  let session={user:{id:fixture.documenting_user_id},organization:{id:fixture.organization_id},capabilities:['review:all','clinical:demo']};
  let observed=Date.now(),stale=false;
  const manager={query:async(sql,params)=>sql.includes('projection_health')?[{observed_at:new Date(observed),oldest_backlog_age_seconds:stale?400:null,
    persistent_failure_count:0,retrying_count:0,stale_run_count:0,last_run_status:'succeeded',is_read_only_replica:false,replay_lag_seconds:null}]:
    (await client.query(sql,params)).rows};
  const database={...manager,transaction:async(_level,run)=>run(manager)};
  const service=new AnalyticsService(database,{get:async()=>session},{analyticsDatabase:async()=>database});
  await client.query('set local role open_triage_api_runtime');
  const fields=await service.elements('test','Same displayed label');
  assert.equal(fields.total,2);assert.notEqual(fields.items[0].id,fields.items[1].id);
  assert.ok(fields.items.every(field=>field.recordCount===1));
  const custom=fields.items.find(field=>field.id.includes(publicId));
  const values=await service.values('test',custom.id);
  assert.deepEqual(values.items,[{identity:{type:'code',value:'historical-draft'},label:'Historical draft value',recordCount:1}]);
  assert.equal((await service.values('test',custom.id,'absent search')).total,0);
  const beyond=await service.values('test',custom.id,'','2');assert.equal(beyond.total,1);assert.deepEqual(beyond.items,[]);
  const definition={version:1,metric:'records',aggregation:'count',visualization:'line',from:'2026-03-28',through:'2026-03-30',groupBy:null,timeGrouping:'day',filters:[{element:custom.id,values:[values.items[0].identity]}]};
  const outsidePeriod=await service.query('test',definition);
  assert.equal(outsidePeriod.completeness.total,0,'a catalog value in a draft cannot contribute to signed metrics');
  assert.equal(outsidePeriod.filters[0].values[0].label,'Historical draft value','historical filter labels survive an empty query');
  assert.deepEqual((await service.values('test',custom.id)).items,values.items,'query dates never narrow discovery');
  session={...session,capabilities:['review:self','clinical:demo'],user:{id:randomUUID()}};
  assert.equal((await service.elements('test','Same displayed label')).total,0,'another clinician cannot discover private history');
  session={...session,capabilities:['review:all'],user:{id:fixture.documenting_user_id}};
  assert.equal((await service.elements('test','Same displayed label')).total,0,'real and synthetic histories remain separate');
  session={...session,capabilities:['review:all','clinical:demo'],organization:{id:randomUUID()}};
  assert.equal((await service.elements('test','Same displayed label')).total,0,'agency isolation applies to metadata and counts');
  session={...session,organization:{id:fixture.organization_id}};
  await client.query('reset role');
  await client.query('update clinical.element_occurrence set tombstoned_at=now() where id=any($1::uuid[])',[occurrences.slice(0,2)]);
  await client.query('set local role open_triage_api_runtime');
  assert.equal((await service.elements('test','Same displayed label')).total,2,'discovery is reused within its short TTL');
  t.mock.timers.tick(30_000);
  assert.equal((await service.elements('test','Same displayed label')).total,1,'removed effective values leave discovery after cache expiry');
  const signed=(await client.query(`select p.reporting_date::text from analytics.review_volume_source p
    join clinical.report r on r.id=p.report_id where p.organization_id=$1 and p.synthetic
      and r.status='signed' and (r.expires_at is null or r.expires_at>now()) limit 1`,[fixture.organization_id])).rows[0];
  assert.ok(signed,'project the signed local fixture before integration tests');
  const query={...definition,from:signed.reporting_date,through:signed.reporting_date,filters:[]};
  const result=await service.query('test',query);assert.ok(result.completeness.total>0);
  for(const [metric,aggregation,qualifiers] of [['eMedications.03','percentage',{}],['eVitals.06','median',{reducer:'first'}],['review.duration.response','mean',{}]]) {
    const analysis=await service.query('test',{...query,metric,aggregation,...qualifiers,groupBy:'eDispatch.05'});
    assert.ok(analysis.cells.length>0,`${metric} produces typed source cells`);
    assert.ok(analysis.cells.every(cell=>cell.value===null||Number.isFinite(cell.value)));
  }
  await client.query('reset role');
  await client.query(`update app_identity.organization set deployment_timezone='Europe/Stockholm' where id=$1`,[fixture.organization_id]);
  await client.query(`update app_identity.agency_settings set time_zone='Europe/Stockholm' where organization_id=$1`,[fixture.organization_id]);
  await client.query('set local role open_triage_api_runtime');
  const spring=await service.query('test',{...query,from:'2026-03-29',through:'2026-03-29'});
  assert.equal(Date.parse(spring.interval.endExclusive)-Date.parse(spring.interval.start),23*3600000);
  const autumn=await service.query('test',{...query,from:'2026-10-25',through:'2026-10-25'});
  assert.equal(Date.parse(autumn.interval.endExclusive)-Date.parse(autumn.interval.start),25*3600000);
  await client.query('reset role');
  await client.query(`update app_identity.organization set deployment_timezone='UTC' where id=$1`,[fixture.organization_id]);
  await client.query(`update app_identity.agency_settings set time_zone=null where organization_id=$1`,[fixture.organization_id]);
  await client.query('set local role open_triage_api_runtime');
  const exportResult=await service.query('test',query);
  observed+=60000;
  assert.equal((await service.query('test',query)).exportRevision,exportResult.exportRevision,'wall-clock observation alone is not a source change');
  const command={definition:query,expectedRevision:exportResult.exportRevision,kind:'records'};
  const csv=await service.export('test',command);
  const lines=csv.split('\r\n').filter(line=>/^"[a-f0-9-]{36}",/.test(line));assert.equal(lines.length,result.completeness.total);
  assert.equal(new Set(lines.map(line=>line.split(',')[0])).size,lines.length,'one export row per matching report');
  await client.query('reset role');
  await client.query(`update analytics_private.epcr set projected_at=projected_at+interval '1 second'
    where organization_id=$1 and synthetic and reporting_date=$2`,[fixture.organization_id,signed.reporting_date]);
  await client.query('set local role open_triage_api_runtime');
  await assert.rejects(service.export('test',command),error=>error.status===409&&!!error.response.result);
  stale=true;await assert.rejects(service.query('test',query),error=>error.status===409);stale=false;
  await client.query('reset role');
  const signedRecord=(await client.query(`select r.*,p.reporting_date::text projected_date,g.id root_id from clinical.report r
    join analytics.review_volume_source p on p.report_id=r.id
    join clinical.group_instance g on g.report_id=r.id and g.group_id='PatientCareReportGroup'
    where r.organization_id=$1 and r.synthetic and r.status='signed' and r.catalog_release_id=$2 limit 1`,
    [fixture.organization_id,fixture.catalog_release_id])).rows[0];
  assert.ok(signedRecord);
  const source=(await client.query('select to_jsonb(o) value from clinical.element_occurrence o where id=$1',[occurrences[4]])).rows[0].value;
  const addedId=randomUUID();const corrected={...source,id:addedId,report_id:signedRecord.id,group_instance_id:signedRecord.root_id,code:'signed-custom',code_display:'Signed custom'};
  const appendAmendment=async(action,correctedValue)=>{
    // Outbox events use transaction time; advance the previous fixture event so
    // two amendments in this rollback transaction retain their distinct keys.
    await client.query(`update integration.outbox_event set occurred_at=occurred_at-interval '1 second'
      where aggregate_type='report' and aggregate_id=$1 and event_type='amendment'`,[signedRecord.id]);
    const amendment=(await client.query(`insert into clinical.amendment(report_id,sequence,author_id,reason,attestation,canonical_sha256)
      values($1,(select coalesce(max(sequence),0)+1 from clinical.amendment where report_id=$1),$2,'Analytics rollback fixture','{"signed":true}',repeat('a',64)) returning id`,
      [signedRecord.id,signedRecord.documenting_user_id])).rows[0];
    await client.query(`insert into clinical.amendment_change(amendment_id,action,target_element_occurrence_id,target_path,original_value,corrected_value)
      values($1,$2,$3,'{}',$4,$5)`,[amendment.id,action,action==='add'?null:addedId,action==='add'?null:corrected,correctedValue]);
  };
  await appendAmendment('add',corrected);
  const customDefinition=definitions[2];
  const projected = await client.query(`insert into analytics_private.epcr_repeatable_element
    select (jsonb_populate_record(null::analytics_private.epcr_repeatable_element,to_jsonb(p)||$2::jsonb)).*
    from analytics_private.epcr_repeatable_element p where p.report_id=$1 and p.value_kind='coded' limit 1`,
    [signedRecord.id,{element_occurrence_id:addedId,element_identity_id:secondId,element_id:`${customDefinition.namespace}.${customDefinition.slug}`,
      custom_definition_id:secondId,is_custom:true,custom_definition:customDefinition,is_identifying:false,
      group_id:null,group_instance_id:null,parent_group_instance_id:null,group_ordinal:null,element_ordinal:0,group_path:[],instance_path:[],
      code:'signed-custom',absence_kind:null,absence_code:null,not_value_code:null,pertinent_negative_code:null,
      normalized_numeric:null,source_unit_code:null,normalized_unit_code:null}]);
  assert.equal(projected.rowCount,1,'signed fixture has a coded projection to extend');
  await client.query('set local role open_triage_api_runtime');
  t.mock.timers.tick(30_000);
  const second=(await service.elements('test','Same displayed label')).items.find(field=>field.id.includes(secondId));
  assert.equal((await service.values('test',second.id,'signed-custom')).items[0].recordCount,1,'effective add amendments enter the live catalog');
  const customResult=await service.query('test',{...query,from:signedRecord.projected_date,through:signedRecord.projected_date,metric:second.id,aggregation:'percentage',visualization:'table'});
  assert.ok(customResult.series.some(series=>series.category?.value==='signed-custom'),'pinned custom identities resolve through the signed source');
  assert.equal(customResult.series.find(series=>series.category?.value==='signed-custom').categoryLabel,'Signed custom');
  await client.query('reset role');await appendAmendment('remove',null);await client.query('set local role open_triage_api_runtime');
  assert.equal((await service.values('test',second.id,'signed-custom')).total,1,'value pages are reused within their short TTL');
  t.mock.timers.tick(30_000);
  assert.equal((await service.values('test',second.id,'signed-custom')).total,0,'removed amendment values disappear without waiting for projection');
  session={...session,capabilities:[]};await assert.rejects(service.export('test',command),error=>error.status===403);
  await client.query('savepoint denied_private_projection');
  await assert.rejects(client.query('select * from analytics_private.epcr limit 1'),/permission denied/);
  await client.query('rollback to savepoint denied_private_projection');
});
