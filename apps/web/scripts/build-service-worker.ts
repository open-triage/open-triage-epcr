import { build } from "esbuild";

async function buildServiceWorker() {
  const buildSha = process.env.OPEN_TRIAGE_BUILD_SHA?.trim() || "local";
  await build({
    entryPoints: ["service-worker/service-worker.ts"],
    bundle: true,
    outfile: "public/sw.js",
    format: "iife",
    target: "es2022",
    minify: process.env.NODE_ENV === "production",
    define: { __OPEN_TRIAGE_BUILD_SHA__: JSON.stringify(buildSha) }
  });
}

void buildServiceWorker();
