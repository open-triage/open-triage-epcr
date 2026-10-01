import { platformRequestError } from "./platform-errors";
import type {
  AssignedCall,
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

/** Create a patient report against the installation's active form. */
export async function createNewPatientReport(session: import("@open-triage/contracts").ClinicianSession): Promise<ReopenOpenCallResponse> {
  const url = apiRequestUrl("/api/reports");
  if (!url) throw new Error("Creating a patient report requires a live connection.");
  const response = await fetch(url, browserRequestInit({ method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken ?? session.accessToken ?? "" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), reportId: crypto.randomUUID(), incidentId: crypto.randomUUID(),
      patientId: crypto.randomUUID(), organizationId: session.organization.id, documentingUserId: session.user.id,
      patientIdentityState: "unknown" }),
  }));
  if (!response.ok) throw await platformRequestError(response);
  const created = await response.json() as { id: string };
  return reopenOpenCall(session.csrfToken ?? session.accessToken ?? "", created.id);
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
  const response = await fetch(assignedCallsUrl(), browserRequestInit());
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<AssignedCallsResponse>;
}

export function openAssignmentUrl(assignmentId: string): string {
  return browserRouteUrl(`/api/calls/${assignmentId}/open`);
}

export function staticOpenAssignmentUrl(): string {
  return `${browserRequestConfiguration().basePath}/demo-open-assignment.json`;
}

export async function openAssignedCall(csrfToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
  let response: Response;
  try {
    const staticExport = browserRequestConfiguration().mode === "static";
    response = await fetch(staticExport ? staticOpenAssignmentUrl() : openAssignmentUrl(assignmentId), browserRequestInit({
      method: staticExport ? "GET" : "POST",
      headers: staticExport ? {} : { "x-csrf-token": csrfToken }
    }));
  } catch {
    throw new Error("The call could not be opened. Check your connection and try again.");
  }
  if (!response.ok) throw await platformRequestError(response);
  const opened = await response.json() as OpenAssignmentResponse;
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
