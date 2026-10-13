import type { ConfirmNewJob } from "../components/new-job-confirmation";
import { PlatformRequestError, platformErrorMessage, platformRequestError } from "./platform-errors";
import { authenticationInstallationGeneration, assertAuthenticationInstallationGeneration } from "./installation-transition-generation";
import type {
  AssignedCall,
  NewJobConfirmation,
  AssignedCallsResponse,
  DispatchConflict,
  DispatchConflictDisposition,
  GenerateSyntheticCallResponse,
  OpenAssignmentResponse,
  OpenCallsResponse,
  ReopenOpenCallResponse,
  SyntheticCallGenerationContext,
} from "@open-triage/contracts";
import {
  apiRequestUrl,
  browserRequestConfiguration,
  browserRequestInit,
  browserRouteUrl,
} from "./browser-api";

export const ASSIGNED_CALL_POLL_INTERVAL_MS = 10_000;

function newJobConnectionError(): PlatformRequestError {
  const code = "calls.newJobConnectionRequired";
  return new PlatformRequestError(code, 0, platformErrorMessage({ code }, 0));
}

/** Normalize native fetch failures without hiding authorization, cancellation or context barriers. */
async function newJobResponse(request: () => Promise<Response>): Promise<Response> {
  try { return await request(); }
  catch (error) {
    if (error instanceof TypeError) throw newJobConnectionError();
    throw error;
  }
}

async function confirmedJobRequest(target: string, csrfToken: string, request: (token?: string) => Promise<Response>, confirm?: ConfirmNewJob): Promise<Response> {
  const generation = authenticationInstallationGeneration();
  let token: string | undefined;
  for (;;) {
    assertAuthenticationInstallationGeneration(generation);
    const response = await newJobResponse(() => request(token));
    assertAuthenticationInstallationGeneration(generation);
    if (response.ok) return response;
    const error = await platformRequestError(response);
    if (!(error instanceof PlatformRequestError) || error.code !== "calls.identityConfirmationRequired" || !confirm) throw error;
    const url = apiRequestUrl("/api/calls/new-job-confirmations");
    if (!url) throw error;
    const prepared = await newJobResponse(() => fetch(url, browserRequestInit({ method: "POST", headers: {
      "content-type": "application/json", "x-csrf-token": csrfToken,
    }, body: JSON.stringify({ target }) })));
    assertAuthenticationInstallationGeneration(generation);
    if (!prepared.ok) throw await platformRequestError(prepared);
    const reminder = await prepared.json() as NewJobConfirmation | null;
    assertAuthenticationInstallationGeneration(generation);
    // A crossed checkpoint is reassessed by the server; an absent reminder grants no proof.
    try { token = reminder ? await confirm(reminder) : undefined; }
    catch (error) {
      if (reminder) {
        // Cancel this attempt. A concurrent user/storage switch independently revokes its session.
        try { await fetch(url, browserRequestInit({ method: "DELETE", headers: {
          "content-type": "application/json", "x-csrf-token": csrfToken,
        }, body: JSON.stringify({ token: reminder.token }) })); } catch { /* Session/context revocation still fails closed. */ }
      }
      throw error;
    }
    assertAuthenticationInstallationGeneration(generation);
  }
}

/** Create a patient report against the installation's active form. */
export async function createNewPatientReport(session: import("@open-triage/contracts").ClinicianSession, confirm?: ConfirmNewJob): Promise<ReopenOpenCallResponse> {
  const generation = authenticationInstallationGeneration();
  const url = apiRequestUrl("/api/reports");
  if (!url) throw newJobConnectionError();
  const commandId = crypto.randomUUID(), reportId = crypto.randomUUID(), incidentId = crypto.randomUUID(), patientId = crypto.randomUUID();
  const response = await confirmedJobRequest(`command:${commandId}`, session.csrfToken ?? session.accessToken ?? "", token => fetch(url, browserRequestInit({ method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "", ...(token ? { "x-job-confirmation": token } : {}) },
    body: JSON.stringify({ commandId, reportId, incidentId,
      patientId, organizationId: session.organization.id, documentingUserId: session.user.id,
      patientIdentityState: "unknown" }),
  })), confirm);
  if (!response.ok) throw await platformRequestError(response);
  const created = await response.json() as { id: string };
  assertAuthenticationInstallationGeneration(generation);
  const opened = await reopenOpenCall(session.csrfToken ?? session.accessToken ?? "", created.id);
  assertAuthenticationInstallationGeneration(generation);
  return opened;
}


export async function fetchSyntheticCallGenerationContext(): Promise<SyntheticCallGenerationContext> {
  const url = apiRequestUrl("/api/calls/synthetic-generation");
  if (!url) throw new Error("Synthetic call generation requires a live connection.");
  const response = await fetch(url, browserRequestInit());
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<SyntheticCallGenerationContext>;
}

export async function generateSyntheticCall(csrfToken: string, unitId: string): Promise<GenerateSyntheticCallResponse> {
  const url = apiRequestUrl("/api/calls/synthetic-generation");
  if (!url) throw new Error("Synthetic call generation requires a live connection.");
  let response: Response;
  try {
    response = await fetch(url, browserRequestInit({
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ unitId }),
    }));
  } catch {
    throw new Error("Synthetic call generation requires a live connection.");
  }
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<GenerateSyntheticCallResponse>;
}

export async function resolveDispatchConflict(
  csrfToken: string,
  reportId: string,
  conflictId: string,
  disposition: DispatchConflictDisposition
): Promise<DispatchConflict> {
  const url = apiRequestUrl(`/api/reports/${reportId}/dispatch-conflicts/${conflictId}`);
  if (!url) throw new Error("Conflict dispositions require a connection to the report server.");
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), disposition })
  }));
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<DispatchConflict>;
}

export function assignedCallsUrl(): string {
  const configuration = browserRequestConfiguration();
  return apiRequestUrl("/api/calls/assigned", configuration)
    ?? `${configuration.basePath}/demo-assigned-calls.json`;
}

export async function fetchAssignedCalls(): Promise<AssignedCallsResponse> {
  const generation = authenticationInstallationGeneration();
  const response = await fetch(assignedCallsUrl(), browserRequestInit());
  assertAuthenticationInstallationGeneration(generation);
  if (!response.ok) throw await platformRequestError(response);
  const result = await response.json() as AssignedCallsResponse;
  assertAuthenticationInstallationGeneration(generation);
  return result;
}

export function openAssignmentUrl(assignmentId: string): string {
  return browserRouteUrl(`/api/calls/${assignmentId}/open`);
}

export function staticOpenAssignmentUrl(): string {
  return `${browserRequestConfiguration().basePath}/demo-open-assignment.json`;
}

export async function openAssignedCall(csrfToken: string, assignmentId: string, confirm?: ConfirmNewJob): Promise<OpenAssignmentResponse> {
  const generation = authenticationInstallationGeneration();
  const staticExport = browserRequestConfiguration().mode === "static";
  const response = await confirmedJobRequest(`assignment:${assignmentId}`, csrfToken, token => fetch(staticExport ? staticOpenAssignmentUrl() : openAssignmentUrl(assignmentId), browserRequestInit({
    method: staticExport ? "GET" : "POST",
    headers: staticExport ? {} : { "x-csrf-token": csrfToken, ...(token ? { "x-job-confirmation": token } : {}) }
  })), confirm);
  assertAuthenticationInstallationGeneration(generation);
  if (!response.ok) throw await platformRequestError(response);
  const opened = await response.json() as OpenAssignmentResponse;
  assertAuthenticationInstallationGeneration(generation);
  if (opened.assignmentId !== assignmentId) throw new Error("The static demo fixture does not match the selected assignment.");
  return opened;
}

export function openCallsUrl(): string {
  const configuration = browserRequestConfiguration();
  return apiRequestUrl("/api/reports/open", configuration)
    ?? `${configuration.basePath}/demo-open-calls.json`;
}

export async function fetchOpenCalls(): Promise<OpenCallsResponse> {
  const response = await fetch(openCallsUrl(), browserRequestInit());
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<OpenCallsResponse>;
}

export function reopenReportUrl(reportId: string): string {
  return browserRouteUrl(`/api/reports/${reportId}/reopen`);
}

export async function reopenOpenCall(csrfToken: string, reportId: string): Promise<ReopenOpenCallResponse> {
  let response: Response;
  try {
    response = await fetch(reopenReportUrl(reportId), browserRequestInit({
      method: "POST",
      headers: { "x-csrf-token": csrfToken }
    }));
  } catch {
    throw new Error("The report could not be reopened. Check your connection and try again.");
  }
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<ReopenOpenCallResponse>;
}

export function canceledAssignedCalls(
  previous: ReadonlyArray<AssignedCall>,
  current: ReadonlyArray<AssignedCall>,
  canceledAssignmentIds: ReadonlyArray<string>
): AssignedCall[] {
  const currentIds = new Set(current.map((call) => call.id));
  const canceledIds = new Set(canceledAssignmentIds);
  return previous.filter((call) => !currentIds.has(call.id) && canceledIds.has(call.id));
}
