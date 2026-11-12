import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { installTlsFixtureControl } from './tls-fixture-control.mjs';
import { pdfServerCompatibilityFixture } from './pdf-server-compatibility-fixture.mjs';
import { pdfDownloadFixture, pdfMediaHoldFixture } from './pdf-download-fixture.mjs';
import { enrollmentBoundaryFixture } from './enrollment-boundary-fixture.mjs';
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const runtimeDatabase = new URL(fixture.databaseUrl);
runtimeDatabase.searchParams.set('options', '-c role=open_triage_api_runtime');
Object.assign(process.env, {
  ANDROID_APPROVED_RELEASE: '',
  OIDC_CREDENTIAL_KEYS_JSON: JSON.stringify({'1': Buffer.alloc(32,44).toString('base64')}),
  DATABASE_URL: runtimeDatabase.toString(), WEB_ORIGIN: fixture.origin, NODE_ENV: 'development',
  PATIENT_KEY_INSTALLATION_ID: fixture.organizationId, PATIENT_KEY_VERSION: '1',
  PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 41).toString('base64'),
  AUTH_RATE_LIMIT_SECRET_BASE64: Buffer.alloc(32, 42).toString('base64'),
  OFFLINE_RECOVERY_KEY_VERSION: '1', OFFLINE_RECOVERY_SECRET_BASE64: Buffer.alloc(32, 43).toString('base64'),
});
// Nest's CJS/ESM bridge must initialize before loading the application's modules on Node 22.
const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../../apps/api/dist/app.module.js');
let upgradeAcceptance;
if(fixture.upgradeAcceptance) {
  const {upgradePolicyFixture}=await import('./upgrade-policy-fixture.mjs');
  upgradeAcceptance=await upgradePolicyFixture(fixture.upgradeAcceptance);
  const {AdminModule}=await import('../../apps/api/dist/admin/admin.module.js');
  const {ANDROID_RELEASE_CATALOG,ANDROID_RELEASE_FETCH}=await import('../../apps/api/dist/admin/android-release.service.js');
  const {ANDROID_RELEASE_LIFECYCLE}=await import('../../apps/api/dist/admin/android-upgrade-policy.service.js');
  // Explicit test-only providers, installed before normal Nest module construction.
  Reflect.defineMetadata('providers',[...Reflect.getMetadata('providers',AdminModule),
    {provide:ANDROID_RELEASE_CATALOG,useValue:upgradeAcceptance.approved},
    {provide:ANDROID_RELEASE_LIFECYCLE,useValue:upgradeAcceptance.lifecycle},
    {provide:ANDROID_RELEASE_FETCH,useValue:upgradeAcceptance.fetcher}],AdminModule);
  process.env.ANDROID_APPROVED_RELEASE=upgradeAcceptance.tag;
}

const { agencyContextMiddleware } = await import('../../apps/api/dist/sessions/agency-context.middleware.js');
const { PlatformErrorFilter } = await import('../../apps/api/dist/platform-error.filter.js');
const { securityHeaders } = await import('../../apps/api/dist/security-headers.js');
const { DataSource } = await import('typeorm');
const { offlineRecoveryWrappingKey } = await import('../../apps/api/dist/reports/protected-report-key.service.js');
const wrapping = offlineRecoveryWrappingKey(process.env);
if (wrapping.version !== 1 || !wrapping.secret.equals(Buffer.alloc(32, 43))) throw new Error('Synthetic recovery key configuration was not applied');
const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false, httpsOptions: { key: await readFile(fixture.keyPath), cert: await readFile(fixture.certPath) } });
const [databaseIdentity] = await app.get(DataSource).query('select current_user as effective_role');
if (databaseIdentity.effective_role !== 'open_triage_api_runtime') throw new Error('Synthetic API must use the restricted runtime role');
// A bounded fixture-only barrier makes lifecycle/policy races deterministic.
// This file is a synthetic API launcher, never the production API entry point.
let acceptedRequests = 0;
let outcomeAvailable = true;
let dropEnrollmentReplies = false;
const enrollmentBoundary=enrollmentBoundaryFixture();
app.use(enrollmentBoundary.middleware);
app.use(pdfServerCompatibilityFixture());
app.use(pdfDownloadFixture());
app.use(pdfMediaHoldFixture());
if(upgradeAcceptance) app.use((request,response,next)=>{
  if(request.url==='/api/__android-upgrade-policy/retire' && request.method==='POST') {
    upgradeAcceptance.retire();return response.json({retired:true});
  }
  next();
});

app.use((request, response, next) => {
  acceptedRequests++;
  if (!outcomeAvailable && request.url === '/api/installations/enrollment-outcome') return response.status(404).json({code:'fixture.unavailable'});
  if (request.url === '/api/__android-enrollment-expire' && request.method === 'POST') {
    let input=''; request.on('data',chunk=>{input+=chunk;if(input.length>1024)request.destroy();});
    request.on('end',()=>{void(async()=>{
      const {token}=JSON.parse(input); if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return response.status(400).json({expired:false});
      const {createHash}=await import('node:crypto');
      const rows=await app.get(DataSource).query(`update app_identity.unit_enrollment set issued_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 minute' where token_sha256=$1 and consumed_at is null returning id`,[createHash('sha256').update(token).digest('hex')]);
      response.json({expired:(Array.isArray(rows[0])?rows[0]:rows).length===1});
    })().catch(()=>response.status(400).json({expired:false}));}); return;
  }
  if (request.url === '/api/__android-enrollment-drop-arm' && request.method === 'POST') {
    dropEnrollmentReplies = true; return response.json({armed: true});
  }
  if (request.url === '/api/__android-enrollment-drop-release' && request.method === 'POST') { dropEnrollmentReplies=false; return response.json({released:true}); }
  if (request.url === '/api/installations/enroll' && request.method === 'POST' && dropEnrollmentReplies) {
    const end = response.end;
    response.end = function(...args) {
      if (this.statusCode >= 200 && this.statusCode < 300) { request.socket.destroy(); return this; }
      return end.apply(this, args);
    };
  }
  next();
});
const managementHolds = new Map();
let webDeployment = 1;
app.use((request, response, next) => {
  if (request.url === '/api/__android-web-deployment') {
    if (request.method === 'POST') webDeployment++;
    return response.json({ revision: webDeployment, marker: `SYNTHETIC-REMOTE-WEB-DEPLOYMENT-${webDeployment}` });
  }
  if (request.url === '/') return response.type('html').send(`<html><body>SYNTHETIC-REMOTE-WEB-DEPLOYMENT-${webDeployment}</body></html>`);
  next();
});

app.use((request, response, next) => {
  const url = new URL(request.url, fixture.origin), id = url.searchParams.get('requestId');
  if (!/^[a-f0-9-]{36}$/.test(id ?? '')) return next();
  if (url.pathname === '/api/__android-managed-hold' && managementHolds.size < 128) {
    const release = () => { managementHolds.delete(id); response.json({ok: true}); };
    const timeout = setTimeout(release, 15000);
    managementHolds.set(id, () => { clearTimeout(timeout); release(); });
    return;
  }
  if (url.pathname === '/api/__android-managed-hold-started') return response.json({pending: managementHolds.has(id)});
  if (url.pathname === '/api/__android-managed-hold-release') {
    const release = managementHolds.get(id); release?.(); return response.json({released: !!release});
  }
  next();
});
// Test-only, bounded write outage and non-secret origin/cookie-presence evidence.
const agencyOutages=new Set(),agencyObservations=[];
let holdNextAgencyConsume=false;
app.use((request,response,next)=>{
 const path=request.url.split('?',1)[0];
 if(path==='/api/__android-agency-consume-hold'&&request.method==='POST'){holdNextAgencyConsume=true;return response.json({armed:true});}
 if(path==='/api/sessions/agency-handoff/consume'&&request.method==='POST'&&holdNextAgencyConsume){
  const end=response.end;
  response.end=function(chunk,...args){
   if(this.statusCode>=200&&this.statusCode<300&&chunk){
    holdNextAgencyConsume=false;this.write(Buffer.from(chunk).subarray(0,5));
    const timeout=setTimeout(()=>request.socket.destroy(),45000);request.socket.once('close',()=>clearTimeout(timeout));return this;
   }
   return end.call(this,chunk,...args);
  };
 }
 if(path==='/api/__android-agency-observations'&&request.method==='GET')return response.json({requests:agencyObservations});
 if(path==='/api/__android-agency-write-outage'&&request.method==='POST'){
  let raw='';request.on('data',chunk=>{raw+=chunk;if(raw.length>1024)request.destroy();});
  request.on('end',()=>{try{const body=JSON.parse(raw);if(typeof body.reportId!=='string'||!/^[a-f0-9-]{36}$/.test(body.reportId)||typeof body.enabled!=='boolean')throw Error();
   if(body.enabled){if(agencyOutages.size>=4&&!agencyOutages.has(body.reportId))throw Error();agencyOutages.add(body.reportId);}else agencyOutages.delete(body.reportId);response.json({enabled:agencyOutages.has(body.reportId)});
  }catch{response.status(400).json({error:'invalid fixture control'});}});return;
 }
 const report=/^\/api\/reports\/([a-f0-9-]{36})\/draft-changes$/.exec(path);
 if(report&&request.method==='POST'&&agencyOutages.has(report[1]))return response.status(503).json({code:'reports.saveUnavailable'});
 if(path.startsWith('/api/sessions/agency-handoff/')&&agencyObservations.length<128)agencyObservations.push({stage:path.split('/').at(-1),origin:request.headers.origin,personal:request.headers.cookie?.includes('open_triage_session=')===true,installation:request.headers.cookie?.includes('open_triage_installation=')===true,challenge:request.headers.cookie?.includes('open_triage_agency_handoff=')===true});
 next();
});
let nativeAuthenticationRequests=0;
app.use((request,response,next)=>{
  if(request.url==='/api/__android-native-authentication-count'&&request.method==='GET')return response.json({count:nativeAuthenticationRequests});
  const path=request.url.split('?',1)[0];
  if(/^\/api\/sessions\/oidc\/native\/(login|finish)$/.test(path)){
    nativeAuthenticationRequests++;
    const json=response.json.bind(response);
    response.json=body=>{console.log('Synthetic native authentication boundary',JSON.stringify({path,status:response.statusCode,
      installationCookie:request.headers.cookie?.includes('open_triage_installation=')===true,
      sessionCookie:request.headers.cookie?.includes('open_triage_session=')===true,outcome:body?.outcome,errorCode:body?.code}));return json(body);};
  }
  next();
});
app.setGlobalPrefix('api'); app.use(agencyContextMiddleware); app.use(securityHeaders); app.useGlobalFilters(new PlatformErrorFilter());
await app.listen(fixture.port, '0.0.0.0');
installTlsFixtureControl(app.getHttpServer(), fixture.tlsVariants, process, readFile, () => acceptedRequests, selected => { outcomeAvailable = selected.outcomeAvailable !== false; });
process.send?.({ ready: true });
console.log(`Synthetic Android fixture ready on port ${fixture.port}`);
process.on('SIGTERM', async () => { console.log('Synthetic Android enrollment HTTP receipts',JSON.stringify(enrollmentBoundary.snapshot()));await app.close(); process.exit(0); });
