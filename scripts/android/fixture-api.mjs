import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
const fixture = JSON.parse(await readFile(process.argv[2], 'utf8'));
Object.assign(process.env, {
  DATABASE_URL: fixture.databaseUrl, WEB_ORIGIN: fixture.origin, NODE_ENV: 'development',
  PATIENT_KEY_INSTALLATION_ID: fixture.organizationId, PATIENT_KEY_VERSION: '1',
  PATIENT_KEY_SECRET_BASE64: Buffer.alloc(32, 41).toString('base64'),
  AUTH_RATE_LIMIT_SECRET_BASE64: Buffer.alloc(32, 42).toString('base64'),
  OFFLINE_RECOVERY_KEY_SECRET_BASE64: Buffer.alloc(32, 43).toString('base64'),
});
// Nest's CJS/ESM bridge must initialize before loading the application's modules on Node 22.
const { NestFactory } = await import('@nestjs/core');
const { AppModule } = await import('../../apps/api/dist/app.module.js');
const { agencyContextMiddleware } = await import('../../apps/api/dist/sessions/agency-context.middleware.js');
const { PlatformErrorFilter } = await import('../../apps/api/dist/platform-error.filter.js');
const { securityHeaders } = await import('../../apps/api/dist/security-headers.js');
const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false, httpsOptions: { key: await readFile(fixture.keyPath), cert: await readFile(fixture.certPath) } });
app.setGlobalPrefix('api'); app.use(agencyContextMiddleware); app.use(securityHeaders); app.useGlobalFilters(new PlatformErrorFilter());
await app.listen(fixture.port, '0.0.0.0');
process.send?.({ ready: true });
console.log(`Synthetic Android fixture ready on port ${fixture.port}`);
process.on('SIGTERM', async () => { await app.close(); process.exit(0); });
