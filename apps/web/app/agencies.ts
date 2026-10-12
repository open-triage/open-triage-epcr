import type { AgencyDirectory, AgencySummary, ClinicianSession, CreateAgencyCommand, UpdateAgencyCommand } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "./browser-api";
import { platformRequestError } from "./platform-errors";

async function request<T>(path: string, csrfToken?: string, method = "GET", body?: unknown): Promise<T> {
  const url = apiRequestUrl(path);
  if (!url) throw new Error("Agency administration requires an online installation.");
  const response = await fetch(url, browserRequestInit({ method, headers: {
    ...(csrfToken ? { "x-csrf-token": csrfToken } : {}), ...(body ? { "content-type": "application/json" } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  if (!response.ok) throw await platformRequestError(response);
  return response.json() as Promise<T>;
}
export const loadAgencies = () => request<AgencyDirectory>("/api/super-admin/agencies");
export const createAgency = (csrfToken: string, command: CreateAgencyCommand) => request<AgencySummary>("/api/super-admin/agencies", csrfToken, "POST", command);
export const updateAgency = (csrfToken: string, id: string, command: UpdateAgencyCommand) => request<AgencySummary>(`/api/super-admin/agencies/${id}`, csrfToken, "PUT", command);
export const switchAgency = (csrfToken: string, id: string) => request<ClinicianSession>(`/api/sessions/agency/${id}`, csrfToken, "POST");
