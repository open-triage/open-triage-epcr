import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep development analytics current using the same bounded projector as production.
const intervalMs = 60_000;
let child;
let timer;
let stopping = false;

function project() {
  child = spawn(process.execPath, [fileURLToPath(new URL("./project-analytics.mjs", import.meta.url))], {
    stdio: "inherit", env: process.env,
  });
  child.on("error", () => console.error(JSON.stringify({ event: "analytics_projection_watch", errorCode: "projector.SpawnError" })));
  child.on("close", () => {
    child = undefined;
    if (!stopping) timer = setTimeout(project, intervalMs);
  });
}

function stop(signal) {
  stopping = true;
  clearTimeout(timer);
  child?.kill(signal);
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
project();
