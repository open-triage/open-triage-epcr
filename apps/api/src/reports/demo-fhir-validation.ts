import { HttpException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ReopenOpenCallResponse } from "@open-triage/contracts";
import { demoFhirWorker, demoWorkspaceRoot } from "./demo-fhir-worker.js";

const exec = promisify(execFile);
let running = false;

type Report = ReopenOpenCallResponse["report"];
type Phase = "building" | "loading" | "validating";
type Job = {
  id: string; owner: string; reportId: string; snapshot: string; started: number;
  phase: Phase | "complete" | "failed"; result?: ValidationResult; completion: Promise<ValidationResult>;
};
const jobs = new Map<string, Job>();

type ValidationResult = Awaited<ReturnType<typeof validateDemoRecord>>;

function validationInput(report: Report) {
  const { id, revision, status, demoMutable, document, notes, clinicalForm } = report;
  return JSON.stringify({ id, revision, status, demoMutable, document, notes,
    clinicalForm: { decisionSupport: clinicalForm?.decisionSupport } });
}

function validationJob(report: Report, owner: string) {
  const input = validationInput(report);
  const snapshot = createHash("sha256").update(input).digest("hex");
  for (const job of jobs.values()) {
    if (job.owner === owner && job.reportId === report.id && job.snapshot === snapshot && job.phase !== "failed") return job;
  }
  if (running) throw new HttpException("demo.fhirValidatorBusy", 429);
  const job: Job = { id: randomUUID(), owner, reportId: report.id, snapshot,
    started: Date.now(), phase: "building", completion: validateDemoRecord(report.revision, input, phase => { job.phase = phase; }) };
  jobs.set(job.id, job);
  void job.completion.then(result => {
    job.result = result;
    job.phase = "complete";
  }, () => { job.phase = "failed"; }).finally(() => {
    setTimeout(() => jobs.delete(job.id), 5 * 60_000).unref();
  });
  return job;
}

export function startDemoValidation(report: Report, owner: string) {
  return { jobId: validationJob(report, owner).id };
}

export function awaitDemoValidation(report: Report, owner: string) {
  return validationJob(report, owner).completion;
}

export function demoValidationStatus(id: string, reportId: string, owner: string) {
  const job = jobs.get(id);
  if (!job || job.owner !== owner || job.reportId !== reportId) throw new NotFoundException();
  return { phase: job.phase, seconds: Math.floor((Date.now() - job.started) / 1000), result: job.result };
}

async function validateDemoRecord(revision: number, input: string, progress?: (phase: Phase) => void) {
  if (running) throw new HttpException("demo.fhirValidatorBusy", 429);
  running = true;
  let dir: string | undefined;
  try {
    const root = demoWorkspaceRoot();
    dir = await mkdtemp(join(tmpdir(), "opentriage-west-"));
    const path = (name: string) => join(dir!, name);
    await writeFile(path("record.json"), input, { mode: 0o600 });
    await exec(process.execPath, ["--import", "tsx", "scripts/generate-demo-record-fhir.mjs",
      path("record.json"), path("bundle.json"), path("projection.json")], { cwd: root, timeout: 30_000 });

    progress?.("loading");
    const validate = await demoFhirWorker(root);
    progress?.("validating");
    await validate(dir);
    const outcome = JSON.parse(await readFile(path("outcome.json"), "utf8"));
    if (outcome.resourceType !== "OperationOutcome" || !Array.isArray(outcome.issue)) throw new Error();
    const projection = JSON.parse(await readFile(path("projection.json"), "utf8"));
    outcome.issue.push(...projection.issues);
    return { revision, assessments: projection.assessments, outcome,
      bundle: JSON.parse(await readFile(path("bundle.json"), "utf8")) };
  } catch {
    throw new ServiceUnavailableException("demo.fhirValidatorUnavailable");
  } finally {
    try { if (dir) await rm(dir, { recursive: true, force: true }); }
    finally { running = false; }
  }
}
