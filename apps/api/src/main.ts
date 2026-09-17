import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { validateAuthenticationThrottleConfiguration } from "./sessions/authentication-throttle.js";

async function bootstrap() {
  validateAuthenticationThrottleConfiguration();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const trustProxyHops = Number(process.env.AUTH_TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 10) {
    throw new Error("AUTH_TRUST_PROXY_HOPS must be an integer between 0 and 10");
  }
  app.set("trust proxy", trustProxyHops);
  // A fully populated canonical encounter currently produces a draft command
  // around 175 KB. Keep a bounded limit, but make it large enough for a whole
  // NEMSIS document mutation rather than Express's 100 KB default.
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    exposedHeaders: ["ETag"],
    credentials: true,
  });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
