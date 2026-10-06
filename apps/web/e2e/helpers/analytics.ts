import type { Page, Route } from '@playwright/test';
import settings from '@open-triage/contracts/config/installation.production.json';
import type { AnalyticsCatalogCountsRequest, AnalyticsDefinition, AnalyticsElement, AnalyticsResult, AnalyticsSavedVisualization, AnalyticsSaveVisualizationCommand } from '@open-triage/contracts';
export const analyticsFields: AnalyticsElement[] = [
  {id:'records',label:'Records',datatype:'records',kind:'categorical',unit:null,operations:['distribution'],aggregations:['count','percentage'],units:[],recordCount:12,grouping:false,filtering:false},
  {id:'metric:shared-version:response',label:'Response time',datatype:'number',kind:'numeric',unit:'min',operations:['mean','median','minimum','maximum'],aggregations:['mean','median','minimum','maximum'],units:['min'],recordCount:0,grouping:false,filtering:false,
    configured:{kind:'metric',id:'response',validationVersionId:'shared-version',version:7,catalogReleaseId:'catalog',compiledSha256:'a'.repeat(64)}},
  {id:'priority',label:'Dispatch priority',datatype:'code',kind:'categorical',unit:null,operations:['distribution'],aggregations:['count','percentage'],units:[],recordCount:12,grouping:true,filtering:true},
  {id:'custom:assessment',label:'Custom assessment',datatype:'code',source:'custom',kind:'categorical',unit:null,operations:['distribution'],aggregations:['count','percentage'],units:[],recordCount:8,grouping:true,filtering:true},
  {id:'vitals',label:'Systolic blood pressure',datatype:'number',kind:'numeric',unit:'mm[Hg]',repeating:true,operations:['mean','median','minimum','maximum'],aggregations:['mean','median','minimum','maximum'],units:['mm[Hg]'],recordCount:10,grouping:true,filtering:true},
  {id:'record.documenting-user',label:'User',datatype:'code',kind:'categorical',unit:null,operations:[],aggregations:[],units:[],recordCount:12,grouping:true,filtering:true},
];
const analyticsUsers = [{ identity: { type: 'code' as const, value: 'user-a' }, label: 'Alex Andersson', recordCount: 2 },
  { identity: { type: 'code' as const, value: 'user-b' }, label: 'Sam Svensson', recordCount: 2 }];
export function analyticsFixture(definition: AnalyticsDefinition, dataset: 'real'|'synthetic'='real', scope: 'own'|'all'='all', fields=analyticsFields): AnalyticsResult {
  const metric=fields.find(field=>field.id===definition.metric)!;
  const total=definition.filters.length?2:4;
  const valid=metric.datatype==='records'?total:total-1;
  const bucket=definition.visualization==='line' ? definition.from : null;
  const groups=definition.groupBy ? ['High','Low'] : [null];
  const series=definition.groupBy==='record.documenting-user' ? analyticsUsers.map((user,index)=>({id:String(index),group:user.identity,groupLabel:user.label,category:null,categoryLabel:null})) :
    groups.map((value,index)=>({id:String(index),group:value ? {type:'code' as const,value}:null,groupLabel:value,category:null,categoryLabel:null}));
  return {definition,metric,group:fields.find(field=>field.id===definition.groupBy) ?? null,filters:[],population:{unit:'patient-report',scope,organizationId:'org',dataset,signedOnly:true},
    timeZone:'Europe/Stockholm',interval:{start:'2026-09-30T22:00:00Z',endExclusive:'2026-10-03T22:00:00Z'},
    freshness:{status:'current',observedAt:'2026-10-03T12:00:00Z',targetSeconds:300,oldestBacklogSeconds:null,replicaLagSeconds:null},
    completeness:{total,valid,missing:total-valid,absent:0,invalid:0},summary:metric.kind==='numeric'?8.3:total,unit:metric.unit,overlapping:false,
    buckets:bucket ? [{key:bucket,from:definition.from,through:definition.through}] : [],series,
    cells:series.map((series,index)=>({series:series.id,bucket,value:8.3+index,count:3,numerator:null,denominator:null,total:4,valid:3,missing:1,absent:0,invalid:0})),exportRevision:'a'.repeat(64)};
}
export async function setupAnalytics(page: Page, options: {demo?:boolean;own?:boolean;fields?:AnalyticsElement[]}={}) {
  const fields=options.fields ?? analyticsFields;
  const session={csrfToken:'analytics-csrf',user:{id:'reviewer',displayName:'Reviewer'},organization:{id:'org',name:'Example EMS'},startedAt:'2026-10-02T08:00:00Z',expiresAt:'2099-10-02T20:00:00Z',
    capabilities:[options.own?'review:self':'review:all',...(options.demo?['clinical:demo']:[])],workspaceAvailable:true};
  const item={id:'123e4567-e89b-42d3-a456-426614174001',reportId:'123e4567-e89b-42d3-a456-426614174002',reportNumber:'PCR-123',criterionId:'criterion',criterionName:'Clinical review',priority:'high',status:'new',assigneeId:null,
    version:1,firstMatchedAt:'2026-10-01T12:00:00Z',reportingDate:'2026-10-01',signedAt:'2026-10-01T12:00:00Z',findings:[]};
  const state={queries:[] as AnalyticsDefinition[],catalog:[] as URL[],exports:[] as Array<{kind:string;definition:AnalyticsDefinition;expectedRevision:string}>,
    saved:[] as Array<AnalyticsSavedVisualization & { definition: AnalyticsDefinition }>, saveCommands:[] as AnalyticsSaveVisualizationCommand[], saveFailure:false, savedListFailure:false, savedAccessDenied:false,
    counts:[] as AnalyticsCatalogCountsRequest[],countMode:'ready' as 'ready'|'fail'|'empty',
    queryError:false,exportMode:'download' as 'download'|'refresh'|'deny',queryHook:undefined as ((route:Route,definition:AnalyticsDefinition)=>Promise<void>)|undefined};
  const dataset=options.demo?'synthetic':'real',scope=options.own?'own':'all';
  await page.addInitScript(stored=>localStorage.setItem('open-triage.clinician-session.v1',JSON.stringify(stored)),session);
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    if(path==='/api/installation') return route.fulfill({json:{settings}});
    if(path==='/api/sessions/current') return route.fulfill({json:session});
    if(path==='/api/review/attention') return route.fulfill({json:{dataset,asOf:new Date().toISOString(),total:0,assignments:0,responses:0,reopened:0,unavailableAssignees:0,unavailableRoutes:0,processingFailures:0}});
    if(path==='/api/review/queue') return route.fulfill({json:{dataset,page:Number(url.searchParams.get('page')??1),pageSize:25,total:1,assignmentCounts:{all:1,mine:0,unassigned:1},asOf:new Date().toISOString(),items:[item]}});
    if(path===`/api/review/items/${item.id}`) return route.fulfill({json:{...item,assignmentHistory:[],progressHistory:[],comments:[],commentsRestricted:true}});
    if(path===`/api/review/reports/${item.reportId}`) return route.fulfill({json:{id:item.reportId,reportingDate:'2026-10-01',signedAt:'2026-10-01T12:00:00Z',amendmentSequence:0,groups:[],values:[],notes:[]}});
    if(['/api/review/routes','/api/review/eligible-reviewers','/api/review/outcomes'].includes(path)) return route.fulfill({json:[]});
    if(path.startsWith('/api/review/analytics/saved') && state.savedAccessDenied) return route.fulfill({status:403,json:{message:'Access revoked'}});
    if(path==='/api/review/analytics/saved' && route.request().method()==='GET') return state.savedListFailure
      ? route.fulfill({status:503,json:{message:'Saved visualizations are unavailable. Please retry.'}})
      : route.fulfill({json:state.saved});
    if(path.startsWith('/api/review/analytics/saved')) {
      const id=path.split('/')[5];
      if(route.request().method()==='GET') {
        const saved=state.saved.find(item=>item.id===id);
        if(!saved)return route.fulfill({status:404,json:{message:'Saved visualization is unavailable'}});
        return route.fulfill({json:{saved,definition:saved.definition,elements:fields,filters:saved.definition.filters.map(filter=>({element:filter.element,
          values:filter.values.map(identity=>({identity,label:String(identity.value),recordCount:0}))}))}});
      }
      const command=route.request().postDataJSON() as AnalyticsSaveVisualizationCommand;state.saveCommands.push(command);
      if(state.saveFailure)return route.fulfill({status:503,json:{message:'Saved visualizations are unavailable. Please retry.'}});
      const current=id?state.saved.find(item=>item.id===id):undefined;
      const saved={id:current?.id??`123e4567-e89b-42d3-a456-${String(state.saved.length+1).padStart(12,'0')}`,
        name:command.name,definition:command.definition,version:(current?.version??0)+1,updatedAt:new Date().toISOString()};
      state.saved=[saved,...state.saved.filter(item=>item.id!==saved.id)];
      return route.fulfill({json:saved});
    }
    const catalogContext={page:1,pageSize:50,scope,dataset,coverage:'readable-history'};
    if(path==='/api/review/analytics/elements') {
      state.catalog.push(url);const search=(url.searchParams.get('search')??'').toLowerCase();
      const purpose=url.searchParams.get('purpose');
      const matching=fields.filter(field=>field.label.toLowerCase().includes(search) &&
        (purpose==='metric' ? field.id==='records' || !!field.configured : purpose==='group' ? field.grouping : field.filtering));
      return route.fulfill({json:{...catalogContext,items:matching,total:matching.length}});
    }
    if(path==='/api/review/analytics/values') {
      if(url.searchParams.get('element')==='record.documenting-user') {
        state.catalog.push(url);
        const items=analyticsUsers.filter(user=>user.label.toLowerCase().includes((url.searchParams.get('search')??'').toLowerCase()));
        return route.fulfill({json:{...catalogContext,items,total:items.length}});
      }
      state.catalog.push(url);return route.fulfill({json:{...catalogContext,items:['High','Low','Historical'].filter(value=>value.toLowerCase().includes((url.searchParams.get('search')??'').toLowerCase())).map(value=>({identity:{type:'code',value},label:value,recordCount:5})),total:3}});
    }
    if(path==='/api/review/analytics/counts') {
      const command=route.request().postDataJSON() as AnalyticsCatalogCountsRequest;state.counts.push(command);
      if(state.countMode==='fail') return route.fulfill({status:503,json:{message:'Analytics is unavailable. Please retry.'}});
      const total=state.countMode==='empty'?0:command.definition.filters.length?2:4;
      const included=command.definition.metric==='records'?total:Math.max(0,total-1);
      return route.fulfill({json:{total,included,
        elements:command.selection.purpose==='values'?[]:command.selection.ids.map(id=>({id,included:id==='records'?total:Math.max(0,total-1)})),
        values:command.selection.purpose==='values'?command.selection.values.map(identity=>({identity,included:Math.max(0,included-1)})):[]}});
    }
    if(path==='/api/review/analytics/query') {
      const definition=route.request().postDataJSON() as AnalyticsDefinition;state.queries.push(definition);
      if(state.queryHook) return state.queryHook(route,definition);
      if(state.queryError) return route.fulfill({status:503,json:{message:'Analytics is unavailable. Please retry.'}});
      return route.fulfill({json:analyticsFixture(definition,dataset,scope,fields)});
    }
    if(path==='/api/review/analytics/export') {
      const command=route.request().postDataJSON();state.exports.push(command);
      if(state.exportMode==='deny') return route.fulfill({status:403,json:{message:'Access revoked'}});
      if(state.exportMode==='refresh') return route.fulfill({status:409,json:{result:{...analyticsFixture(command.definition,dataset,scope,fields),exportRevision:'b'.repeat(64),summary:9.5}}});
      return route.fulfill({contentType:'text/csv',headers:{'Content-Disposition':'attachment; filename="analytics.csv"'},body:'"value","count"\r\n"8.3","4"\r\n'});
    }
    return route.fulfill({status:404});
  });
  await page.goto('/');
  return state;
}
