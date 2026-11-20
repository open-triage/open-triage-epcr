"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminText } from "../app/admin-localization";
import { browserRequestInit, browserRouteUrl } from "../app/browser-api";

interface ValidationResult {
  revision: number;
  assessments: number;
  bundle: { resourceType: "Bundle" };
  outcome: { resourceType: "OperationOutcome"; issue: {
    severity: string; code: string; diagnostics?: string; details?: { text?: string }; expression?: string[];
  }[] };
}

function download(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DemoFhirValidation({ reportId, csrf }: { reportId: string; csrf: string }) {
  const t = useAdminText();
  const dialog = useRef<HTMLDialogElement>(null);
  const current = useRef<AbortController | null>(null);
  const [result, setResult] = useState<ValidationResult>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ phase: "building" | "loading" | "validating"; seconds: number }>();
  useEffect(() => () => current.current?.abort(), []);

  async function validate() {
    if (current.current) return;
    const controller = new AbortController();
    current.current = controller;
    setResult(undefined);
    setError("");
    setPending(true);
    setProgress(undefined);
    const deadline = window.setTimeout(() => controller.abort("timeout"), 240_000);
    dialog.current?.showModal();
    try {
      const path = `/api/reports/${reportId}/demo/fhir-validation`;
      const response = await fetch(browserRouteUrl(path + "?background=true"), browserRequestInit({
        method: "POST", headers: { "x-csrf-token": csrf }, signal: controller.signal,
      }));
      if (!response.ok) {
        setError(response.status === 429 ? "admin.fhirBusy" : "admin.fhirUnavailable");
        return;
      }
      const { jobId } = await response.json();
      if (typeof jobId !== "string") throw new Error();
      while (!controller.signal.aborted) {
        const poll = await fetch(browserRouteUrl(path + "/" + encodeURIComponent(jobId)), browserRequestInit({ signal: controller.signal }));
        if (!poll.ok) throw new Error();
        const status = await poll.json();
        if (status.phase === "complete" && status.result?.outcome?.resourceType === "OperationOutcome") {
          setResult(status.result);
          return;
        }
        if (!["building", "loading", "validating"].includes(status.phase)) throw new Error();
        setProgress({ phase: status.phase, seconds: status.seconds });
        await new Promise(resolve => window.setTimeout(resolve, 1000));
      }
    } catch {
      if (!controller.signal.aborted) setError("admin.fhirUnavailable");
    } finally {
      window.clearTimeout(deadline);
      if (controller.signal.reason === "timeout") setError("admin.fhirTimeout");
      current.current = null;
      setPending(false);
    }
  }

  const issues = result?.outcome.issue ?? [];
  const findings = issues.filter(issue => issue.severity !== "information");
  return <>
    <button type="button" onClick={() => pending ? dialog.current?.showModal() : void validate()}>{t("admin.validateFhir")}</button>
    <dialog ref={dialog} className="demo-fhir-dialog" aria-label={t("admin.validateFhir")}>
      <h2>{t("admin.validateFhir")}</h2>
      {pending && <p role="status">{progress ? t({ building: "admin.fhirBuilding", loading: "admin.fhirLoading", validating: "admin.fhirValidating" }[progress.phase], { seconds: progress.seconds }) : t("admin.fhirWorking")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      {result && <>
        <p role="status">{t("admin.fhirSummary", { revision: result.revision, assessments: result.assessments,
          errors: findings.filter(issue => ["fatal", "error"].includes(issue.severity)).length,
          warnings: findings.filter(issue => issue.severity === "warning").length })}</p>
        {findings.length > 0 && <ul>{findings.map((issue, index) => <li key={index}>
          {issue.expression?.join(", ")} {issue.details?.text ?? issue.diagnostics ?? issue.code}
        </li>)}</ul>}
        <button type="button" onClick={() => download(result.bundle, reportId + "-bundle.json")}>{t("admin.fhirPayload")}</button>
        <button type="button" onClick={() => download(result.outcome, reportId + "-outcome.json")}>{t("admin.fhirOutcome")}</button>
      </>}
      <button type="button" onClick={() => dialog.current?.close()}>{t("admin.close")}</button>
    </dialog>
  </>;
}
