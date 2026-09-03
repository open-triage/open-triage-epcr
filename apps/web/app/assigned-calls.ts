import type {
  AssignedCall,
  AssignedCallsResponse,
  OpenAssignmentResponse,
  OpenCallsResponse,
  ReopenOpenCallResponse
} from "@open-triage/contracts";

export const ASSIGNED_CALL_POLL_INTERVAL_MS = 10_000;

function apiBaseUrl(): string | null {
  if (process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION === "true" || process.env.NEXT_PUBLIC_BASE_PATH) return null;
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
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
    headers: { authorization: `Bearer ${accessToken}` }
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

export async function openAssignedCall(accessToken: string, assignmentId: string): Promise<OpenAssignmentResponse> {
  let response: Response;
  try {
    response = await fetch(openAssignmentUrl(assignmentId), {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` }
    });
  } catch {
    throw new Error("The call could not be opened. Check your connection and try again.");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("Your shift session has ended.");
    if (response.status === 409) throw new Error("This call can no longer be opened.");
    throw new Error("The call could not be opened. Check your connection and try again.");
  }
  return response.json() as Promise<OpenAssignmentResponse>;
}

export function openCallsUrl(): string {
  const baseUrl = apiBaseUrl();
  if (baseUrl) return `${baseUrl}/api/reports/open`;
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";
  return `${basePath}/demo-open-calls.json`;
}

export async function fetchOpenCalls(accessToken: string): Promise<OpenCallsResponse> {
  const response = await fetch(openCallsUrl(), {
    cache: "no-store",
    headers: { authorization: `Bearer ${accessToken}` }
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

export async function reopenOpenCall(accessToken: string, reportId: string): Promise<ReopenOpenCallResponse> {
  let response: Response;
  try {
    response = await fetch(reopenReportUrl(reportId), {
      method: "POST",
      cache: "no-store",
      headers: { authorization: `Bearer ${accessToken}` }
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
