import { build } from "esbuild";

async function buildServiceWorker() {
  await build({
    entryPoints: ["service-worker/service-worker.ts"],
    bundle: true,
    outfile: "public/sw.js",
    format: "iife",
    target: "es2022",
    minify: process.env.NODE_ENV === "production"
  });
}

void buildServiceWorker();
