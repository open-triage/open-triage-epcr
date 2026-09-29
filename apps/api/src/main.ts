import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { validateAuthenticationThrottleConfiguration } from "./sessions/authentication-throttle.js";
import { securityHeaders } from "./security-headers.js";
import { PlatformErrorFilter } from "./platform-error.filter.js";

async function bootstrap() {
  validateAuthenticationThrottleConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const trustProxyHops = Number(process.env.AUTH_TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer between 0 and 10");
  }
  app.set("trust proxy", trustProxyHops);
  app.use(securityHeaders);
  // A canonical photo or fully populated encounter can produce a large command.
  // Keep one bounded JSON limit large enough for a normalized 2560 px JPEG or whole
  // NEMSIS document mutation rather than Express's 100 KB default.
  app.useBodyParser("json", { limit: "64mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new PlatformErrorFilter());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    exposedHeaders: ["ETag"],
    credentials: true,
  });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
