import type { AnalyticsDefinition, AnalyticsResult } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "../app/browser-api";
export class AnalyticsRequestError extends Error {
  constructor(public status: number, message: string, public result?: AnalyticsResult) { super(message); }
}
export async function analyticsRequest<T>(path: string, csrfToken: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const url = apiRequestUrl(`/api/review/analytics/${path}`);
  if (!url) throw new AnalyticsRequestError(503, "Analytics API is unavailable");
  const response = await fetch(url, browserRequestInit({ signal, cache: "no-store", ...(body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify(body),
  }) }));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string; result?: AnalyticsResult };
    throw new AnalyticsRequestError(response.status, typeof payload.message === "string" ? payload.message : "Analytics is unavailable", payload.result);
  }
  if (path === "export") {
    if (!response.headers.get("content-type")?.includes("text/csv")) throw new AnalyticsRequestError(502, "CSV is unavailable");
    return await response.blob() as T;
  }
  return await response.json() as T;
}
export function analyticsSignature(definition: AnalyticsDefinition): string {
  return JSON.stringify({ ...definition, filters: definition.filters.map((filter) => ({ ...filter,
    values: [...filter.values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort((a, b) => a.element.localeCompare(b.element)) });
}
