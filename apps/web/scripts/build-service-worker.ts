import { build } from "esbuild";
import { selectedInstallationSettings } from "../app/installation-settings.js";

async function buildServiceWorker() {
  await build({
    entryPoints: ["service-worker/service-worker.ts"],
    bundle: true,
    outfile: "public/sw.js",
    format: "iife",
    target: "es2022",
    define: {
      SAMPLE_DISPATCH_ASSIGNMENT_ENABLED: JSON.stringify(selectedInstallationSettings().sampleDispatchAssignment.enabled),
    },
    minify: process.env.NODE_ENV === "production"
  });
}

void buildServiceWorker();
