import type { AdminContext, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, PublishedCatalog, PublishedStationaryForm, StationaryFormActivation, StationaryFormDraft } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestInit } from "./browser-api";

async function catalogRequest<T>(path: string, csrfToken?: string, init?: RequestInit): Promise<T> {
  const url = apiRequestUrl(`/api/admin/${path}`);
  if (!url) throw new Error("Administration is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit({
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...init?.headers }
  }));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; findings?: string[] };
    const message = Array.isArray(body.findings) ? body.findings.join("; ") : body.message;
    throw new Error(message || (response.status === 409 ? "The catalog draft changed in another tab." : "Catalog request failed."));
  }
  return response.json() as Promise<T>;
}

export const loadCatalogDraft = () => catalogRequest<CatalogDraft | null>("catalog-draft");
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
export const loadStationaryFormDraft = () => catalogRequest<StationaryFormDraft | null>("form-draft");
export const cloneStationaryFormDraft = (csrfToken: string, catalogReleaseId: string, displayName: string) => catalogRequest<StationaryFormDraft>("form-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ catalogReleaseId, displayName })
});
export const saveStationaryFormDraft = (csrfToken: string, draft: StationaryFormDraft) => catalogRequest<StationaryFormDraft>(`form-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, definition: draft.definition })
});
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
  const url = apiRequestUrl("/api/admin/context");
  if (!url) throw new Error("Administration is unavailable in the static demonstration.");
  const response = await fetch(url, browserRequestInit());
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Your account is not authorized to administer this installation."
      : "Administration configuration is unavailable.");
  }
  return response.json() as Promise<AdminContext>;
}
