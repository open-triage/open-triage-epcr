import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { installTlsFixtureControl } from './tls-fixture-control.mjs';
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
const pdfMediaHolds = new Set();
app.use((request, response, next) => {
  acceptedRequests++;
  const mediaControl = new URL(request.url,fixture.origin);
  if (mediaControl.pathname === '/api/__android-pdf-media-hold' && request.method === 'POST') {
    const id=mediaControl.searchParams.get('reportId');
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id??''))return response.status(400).json({held:false});
    if(mediaControl.searchParams.get('hold')==='1'&&pdfMediaHolds.size<4)pdfMediaHolds.add(id);else pdfMediaHolds.delete(id);
    return response.json({held:pdfMediaHolds.has(id)});
  }
  const photoUpload=/^\/api\/reports\/([a-f0-9-]{36})\/photos$/.exec(mediaControl.pathname);
  if(request.method==='POST'&&photoUpload&&pdfMediaHolds.has(photoUpload[1]))return response.status(503).json({code:'fixture.media-unavailable'});
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
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
