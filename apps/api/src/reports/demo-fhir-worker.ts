import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { westFhirMapping } from "../../../../defines/decision_support/west-localization.mjs";

export function demoWorkspaceRoot() {
  let directory = process.cwd();
  while (!existsSync(join(directory, "scripts/generate-demo-record-fhir.mjs"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Demo generator unavailable");
    directory = parent;
  }
  return directory;
}

function jarPath(root: string) {
  return resolve(process.env.FHIR_VALIDATOR_JAR ?? join(root, ".local/fhir-validator/validator_cli.jar"));
}

type Worker = (directory: string) => Promise<void>;
let active: Promise<Worker> | undefined;

async function launch(root: string, onExit: () => void): Promise<Worker> {
  const local = join(root, ".local/fhir-validator");
  const jar = jarPath(root);
  const ig = resolve(process.env.WEST_FHIR_PACKAGE ?? join(local, "package.tgz"));
  await access(jar);
  if (createHash("sha256").update(await readFile(ig)).digest("hex") !== westFhirMapping.sha256)
    throw new Error("Unexpected WEST package");
  const bundledJava = join(root, ".local/android-toolchain/jdk/bin/java");
  const java = process.env.FHIR_VALIDATOR_JAVA ?? (existsSync(bundledJava) ? bundledJava : "java");
  const home = process.env.FHIR_VALIDATOR_HOME ?? (existsSync(join(local, "home")) ? join(local, "home") : undefined);
  // HL7 also writes diagnostics to stdout. Only accept replies from this worker protocol.
  const prefix = randomUUID() + " ";
  const child = spawn(java, ["-Xmx2g", ...(home ? ["-Duser.home=" + resolve(home)] : []),
    "-cp", jar, join(root, "scripts/DemoFhirValidator.java"), ig,
    process.env.FHIR_VALIDATOR_TX_SERVER || "https://tx.fhir.org/r4",
    join(root, "packages/contracts/fhir/west-a/bundle.example.json"), prefix], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  let closed = false;
  let pending: { reply: string; finish: (error?: Error) => void } | undefined;
  function stop() {
    if (closed) return;
    closed = true;
    child.kill("SIGKILL");
    pending?.finish(new Error("FHIR validator stopped"));
    onExit();
  }
  function expect(reply: string) {
    return new Promise<void>((resolve, reject) => {
      if (closed || pending) return reject(new Error("FHIR validator unavailable"));
      const timer = setTimeout(stop, 180_000);
      pending = { reply, finish(error) {
        clearTimeout(timer);
        pending = undefined;
        if (error) reject(error); else resolve();
      } };
    });
  }
  child.once("error", stop);
  child.once("exit", stop);
  child.stdin.on("error", stop);
  lines.on("line", line => {
    if (line === prefix + "FAILED") pending?.finish(new Error("FHIR validation failed"));
    else if (pending && line === prefix + pending.reply) pending.finish();
  });
  await expect("READY");
  return directory => {
    if (closed || pending || /[\r\n]/.test(directory)) return Promise.reject(new Error("FHIR validator unavailable"));
    const done = expect("DONE");
    child.stdin.write(directory + "\n");
    return done;
  };
}

export function demoFhirWorker(root: string) {
  if (!active) {
    const clear = () => { if (active === starting) active = undefined; };
    const starting: Promise<Worker> = launch(root, clear).catch(error => { clear(); throw error; });
    active = starting;
  }
  return active;
}

// Development installations with the validator installed keep one engine warm for the API lifetime.
export function prewarmDemoFhir() {
  let root: string;
  try { root = demoWorkspaceRoot(); } catch { return; }
  if (!existsSync(jarPath(root))) return;
  const ensure = () => { void demoFhirWorker(root).catch(() => console.warn("Demo FHIR validator warm-up failed")); };
  ensure();
  setInterval(ensure, 60_000).unref();
}
