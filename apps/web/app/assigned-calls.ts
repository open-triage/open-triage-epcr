import type { AssignedCall, AssignedCallsResponse } from "@open-triage/contracts";

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

export function canceledAssignedCalls(
  previous: ReadonlyArray<AssignedCall>,
  current: ReadonlyArray<AssignedCall>,
  canceledAssignmentIds: ReadonlyArray<string>
): AssignedCall[] {
  const currentIds = new Set(current.map((call) => call.id));
  const canceledIds = new Set(canceledAssignmentIds);
  return previous.filter((call) => !currentIds.has(call.id) && canceledIds.has(call.id));
}
