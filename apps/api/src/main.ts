import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // A fully populated canonical encounter currently produces a draft command
  // around 175 KB. Keep a bounded limit, but make it large enough for a whole
  // NEMSIS document mutation rather than Express's 100 KB default.
  app.useBodyParser("json", { limit: "1mb" });
  app.useBodyParser("urlencoded", { limit: "1mb", extended: true });
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    exposedHeaders: ["ETag"],
  });
  await app.listen(Number(process.env.PORT ?? 3001));
}

void bootstrap();
