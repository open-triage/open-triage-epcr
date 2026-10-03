import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the production worker in bounded, sequential batches during local development.
export function watchReviewWorker({
  workerPath = fileURLToPath(new URL("../dist/review/review-worker.entry.js", import.meta.url)),
  intervalMs = 1_000,
} = {}) {
  let child;
  let timer;
  let stopping = false;

  function schedule() {
    if (!stopping) timer = setTimeout(work, intervalMs);
  }

  function work() {
    // Nest's initial compilation may still be creating the worker entry point.
    if (!existsSync(workerPath)) {
      schedule();
      return;
    }
    child = spawn(process.execPath, [workerPath], { stdio: "inherit", env: process.env });
    child.on("error", () => console.error(JSON.stringify({
      event: "review_worker_watch", errorCode: "worker.SpawnError",
    })));
    child.on("close", () => {
      child = undefined;
      schedule();
    });
  }

  function stop(signal = "SIGTERM") {
    stopping = true;
    clearTimeout(timer);
    child?.kill(signal);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  work();
  return stop;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  watchReviewWorker();
}
