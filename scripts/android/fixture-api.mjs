import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
const runtimeDatabase = new URL(fixture.databaseUrl);
runtimeDatabase.searchParams.set('options', '-c role=open_triage_api_runtime');
Object.assign(process.env, {
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
app.use((request,response,next)=>{
  const path=request.url.split('?',1)[0];
  if(/^\/api\/sessions\/oidc\/native\/(login|finish)$/.test(path)){
    const json=response.json.bind(response);
    response.json=body=>{console.log('Synthetic native authentication boundary',JSON.stringify({path,status:response.statusCode,
      installationCookie:request.headers.cookie?.includes('open_triage_installation=')===true,
      sessionCookie:request.headers.cookie?.includes('open_triage_session=')===true,outcome:body?.outcome,errorCode:body?.code}));return json(body);};
  }
  next();
});
app.setGlobalPrefix('api'); app.use(agencyContextMiddleware); app.use(securityHeaders); app.useGlobalFilters(new PlatformErrorFilter());
await app.listen(fixture.port, '0.0.0.0');
process.send?.({ ready: true });
console.log(`Synthetic Android fixture ready on port ${fixture.port}`);
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
