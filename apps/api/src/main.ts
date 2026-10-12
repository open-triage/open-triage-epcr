import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { validateAuthenticationThrottleConfiguration } from "./sessions/authentication-throttle.js";
import { securityHeaders } from "./security-headers.js";
import { PlatformErrorFilter } from "./platform-error.filter.js";
import { agencyRequest, browserOrigin } from "./sessions/agency-context.js";
import { AgencyDirectoryService } from "./sessions/agency-directory.service.js";

async function bootstrap() {
  validateAuthenticationThrottleConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const trustProxyHops = Number(process.env.AUTH_TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer between 0 and 10");
  }
  app.set("trust proxy", trustProxyHops);
  app.use((request: Parameters<typeof browserOrigin>[0], response: { status(code: number): { json(body: unknown): void } }, next: () => void) => {
    try { agencyRequest.run({ origin: browserOrigin(request), organizationId: request.headers["x-organization-id"] }, next); }
    catch { response.status(400).json({ message: "A valid application origin is required" }); }
  });
  app.use(securityHeaders);
  // A canonical photo or fully populated encounter can produce a large command.
  // Keep one bounded JSON limit large enough for a normalized 2560 px JPEG or whole
  // NEMSIS document mutation rather than Express's 100 KB default.
  app.useBodyParser("json", { limit: "64mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new PlatformErrorFilter());
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      void app.get(AgencyDirectoryService).allowsOrigin(origin).then((allowed) => callback(null, allowed))
        .catch(() => callback(null, false));
    },
    exposedHeaders: ["ETag"],
    credentials: true,
  });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
