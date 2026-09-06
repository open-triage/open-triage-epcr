import type {
  AssignedCall,
  AssignedCallsResponse,
  DispatchConflict,
  DispatchConflictDisposition,
  OpenAssignmentResponse,
  OpenCallsResponse,
  ReopenOpenCallResponse
} from "@open-triage/contracts";

export const ASSIGNED_CALL_POLL_INTERVAL_MS = 10_000;

function apiBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true" || process.env.NEXT_PUBLIC_BASE_PATH) return null;
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

export async function resolveDispatchConflict(
  csrfToken: string,
  reportId: string,
  conflictId: string,
  disposition: DispatchConflictDisposition
): Promise<DispatchConflict> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) throw new Error("Conflict dispositions require a connection to the report server.");
  const response = await fetch(`${baseUrl}/api/reports/${reportId}/dispatch-conflicts/${conflictId}`, {
    method: "POST", cache: "no-store",
    credentials: "include",
    headers: { "x-csrf-token": csrfToken, "content-type": "application/json" },
    body: JSON.stringify({ commandId: crypto.randomUUID(), disposition })
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Your shift session has ended." : "The dispatch difference could not be resolved.");
  return response.json() as Promise<DispatchConflict>;
}

export function assignedCallsUrl(): string {
  const baseUrl = apiBaseUrl();
  if (baseUrl) return `${baseUrl}/api/calls/assigned`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/demo-assigned-calls.json`;
}

export async function fetchAssignedCalls(accessToken: string): Promise<AssignedCallsResponse> {
  const response = await fetch(assignedCallsUrl(), {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Your shift session has ended." : "Assigned calls could not be refreshed.");
  return response.json() as Promise<AssignedCallsResponse>;
}

export function openAssignmentUrl(assignmentId: string): string {
  const baseUrl = apiBaseUrl();
  if (baseUrl) return `${baseUrl}/api/calls/${assignmentId}/open`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/api/calls/${assignmentId}/open`;
}

export function staticOpenAssignmentUrl(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/demo-open-assignment.json`;
}

export async function openAssignedCall(csrfToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
  let response: Response;
  try {
    const staticExport = Boolean(process.env.NEXT_PUBLIC_BASE_PATH);
    response = await fetch(staticExport ? staticOpenAssignmentUrl() : openAssignmentUrl(assignmentId), {
      method: staticExport ? "GET" : "POST",
      cache: "no-store",
      credentials: "include",
      headers: staticExport ? {} : { "x-csrf-token": csrfToken }
    });
  } catch {
    throw new Error("The call could not be opened. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your shift session has ended.");
    if (response.status === 409) throw new Error("This call can no longer be opened.");
    throw new Error("The call could not be opened. Check your connection and try again.");
  }
  const opened = await response.json() as OpenAssignmentResponse;
  if (opened.assignmentId !== assignmentId) throw new Error("The static demo fixture does not match the selected assignment.");
  return opened;
}

export function openCallsUrl(): string {
  const baseUrl = apiBaseUrl();
  if (baseUrl) return `${baseUrl}/api/reports/open`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/demo-open-calls.json`;
}

export async function fetchOpenCalls(_csrfToken: string): Promise<OpenCallsResponse> {
  const response = await fetch(openCallsUrl(), {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) throw new Error(response.status === 401 ? "Your shift session has ended." : "Open calls could not be refreshed.");
  return response.json() as Promise<OpenCallsResponse>;
}

export function reopenReportUrl(reportId: string): string {
  const baseUrl = apiBaseUrl();
  if (baseUrl) return `${baseUrl}/api/reports/${reportId}/reopen`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/api/reports/${reportId}/reopen`;
}

export async function reopenOpenCall(csrfToken: string, reportId: string): Promise<ReopenOpenCallResponse> {
  let response: Response;
  try {
    response = await fetch(reopenReportUrl(reportId), {
      method: "POST",
      cache: "no-store",
      credentials: "include",
      headers: { "x-csrf-token": csrfToken }
    });
  } catch {
    throw new Error("The report could not be reopened. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your shift session has ended.");
    if (response.status === 404 || response.status === 409) throw new Error("This report is no longer available to reopen.");
    throw new Error("The report could not be reopened. Check your connection and try again.");
  }
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
