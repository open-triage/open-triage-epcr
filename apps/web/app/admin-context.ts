import type { AdminContext, AdminRoleList, AdminRoleSummaryList, AdminUserPage, CatalogDefinitionView, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, PublishedCatalog, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit, browserRouteUrl } from "./browser-api";

async function catalogRequest<T>(path: string, csrfToken?: string, init?: RequestInit,
  emptyResponse?: { value: T }): Promise<T> {
  const requestPath = `/api/admin/${path}`;
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    throw new Error("Administration is unavailable in the static demonstration.");
  }
  const url = apiRequestUrl(requestPath, configuration) ?? browserRouteUrl(requestPath, configuration);
  const response = await fetch(url, browserRequestInit({
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...init?.headers }
  }));
  const responseText = await response.text();
  if (!response.ok) {
    let body: { message?: string; findings?: string[] } = {};
    try { body = responseText ? JSON.parse(responseText) as typeof body : {}; } catch {}
    const message = Array.isArray(body.findings) ? body.findings.join("; ") : body.message;
    throw new Error(message || (response.status === 409 ? "The catalog draft changed in another tab." : "Catalog request failed."));
  }
  if (!responseText) {
    if (emptyResponse) return emptyResponse.value;
    throw new Error("The administration server returned an empty response.");
  }
  return JSON.parse(responseText) as T;
}

export const loadCatalogDraft = () => catalogRequest<CatalogDraft | null>("catalog-draft", undefined, undefined, { value: null });
export const loadActiveCatalogDefinition = () => catalogRequest<CatalogDefinitionView | null>("catalog-definition", undefined, undefined, { value: null });
export const cloneCatalogDraft = (csrfToken: string, displayName: string) => catalogRequest<CatalogDraft>("catalog-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ displayName })
});
export const saveCatalogDraft = (csrfToken: string, draft: CatalogDraft) => catalogRequest<CatalogDraft>(`catalog-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, definition: draft.definition })
});
export const validateCatalogDraft = (csrfToken: string, id: string) => catalogRequest<CatalogValidationResult>(`catalog-drafts/${id}/validate`, csrfToken, { method: "POST" });
export const publishCatalogDraft = (csrfToken: string, draft: CatalogDraft, displayName: string, changeNote: string) => catalogRequest<PublishedCatalog>(`catalog-drafts/${draft.id}/publish`, csrfToken, {
  method: "POST", body: JSON.stringify({ expectedRevision: draft.revision, definitionSha256: draft.definitionSha256, displayName, changeNote })
});
export const loadStationaryFormDraft = () => catalogRequest<StationaryFormDraft | null>("form-draft", undefined, undefined, { value: null });
export const cloneStationaryFormDraft = (csrfToken: string, catalogReleaseId: string, displayName: string) => catalogRequest<StationaryFormDraft>("form-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ catalogReleaseId, displayName })
});
export const saveStationaryFormDraft = (csrfToken: string, draft: StationaryFormDraft) => catalogRequest<StationaryFormDraft>(`form-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, definition: draft.definition })
});
export const deleteStationaryFormDraft = (csrfToken: string, draft: StationaryFormDraft) => catalogRequest<void>(`form-drafts/${draft.id}`, csrfToken, {
  method: "DELETE", body: JSON.stringify({ expectedRevision: draft.revision })
}, { value: undefined });
export const publishStationaryFormDraft = (csrfToken: string, draft: StationaryFormDraft, displayName: string, changeNote: string) =>
  catalogRequest<PublishedStationaryForm>(`form-drafts/${draft.id}/publish`, csrfToken, {
    method: "POST", body: JSON.stringify({ expectedRevision: draft.revision,
      definitionSha256: draft.definitionSha256, displayName, changeNote })
  });
export const activateStationaryForm = (csrfToken: string, formVersionId: string, changeNote: string) =>
  catalogRequest<StationaryFormActivation>(`form-versions/${formVersionId}/activate`, csrfToken, {
    method: "POST", body: JSON.stringify({ changeNote })
  });

export const searchFormCatalog = (id: string, query: string) =>
  catalogRequest<FormCatalogElementPage>(`form-drafts/${id}/catalog-elements?query=${encodeURIComponent(query)}`);

export async function loadAdminContext(): Promise<AdminContext> {
  const requestPath = "/api/admin/context";
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    throw new Error("Administration is unavailable in the static demonstration.");
  }
  const url = apiRequestUrl(requestPath, configuration) ?? browserRouteUrl(requestPath, configuration);
  const response = await fetch(url, browserRequestInit());
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Your account is not authorized to administer this installation."
      : "Administration configuration is unavailable.");
  }
  return response.json() as Promise<AdminContext>;
}

export type AdminUserQuery = {
  search?: string;
  state?: "active" | "disabled" | "all";
  roleId?: string;
  cursor?: string;
  limit?: number;
};

function queryString(query: Record<string, string | number | undefined>): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") parameters.set(key, String(value));
  const encoded = parameters.toString();
  return encoded ? `?${encoded}` : "";
}

export const loadAdminUsers = (query: AdminUserQuery = {}) =>
  catalogRequest<AdminUserPage>(`users${queryString(query)}`);

export const loadAdminRoles = (state: "active" | "disabled" | "all" = "active") =>
  catalogRequest<AdminRoleList>(`roles${queryString({ state })}`);

export const loadAdminUserRoleOptions = () => catalogRequest<AdminRoleSummaryList>("user-role-options");
