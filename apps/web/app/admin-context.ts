import type { AdminContext, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, PublishedCatalog, StationaryFormDraft } from "@open-triage/contracts";

function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:3001";
}

async function catalogRequest<T>(path: string, csrfToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}/api/admin/${path}`, {
    credentials: "include", cache: "no-store", ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.method && init.method !== "GET" ? { "x-csrf-token": csrfToken } : {}), ...init?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; findings?: string[] };
    const message = Array.isArray(body.findings) ? body.findings.join("; ") : body.message;
    throw new Error(message || (response.status === 409 ? "The catalog draft changed in another tab." : "Catalog request failed."));
  }
  return response.json() as Promise<T>;
}

export const loadCatalogDraft = (csrfToken: string) => catalogRequest<CatalogDraft | null>("catalog-draft", csrfToken);
export const cloneCatalogDraft = (csrfToken: string) => catalogRequest<CatalogDraft>("catalog-drafts", csrfToken, { method: "POST" });
export const saveCatalogDraft = (csrfToken: string, draft: CatalogDraft) => catalogRequest<CatalogDraft>(`catalog-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, definition: draft.definition })
});
export const validateCatalogDraft = (csrfToken: string, id: string) => catalogRequest<CatalogValidationResult>(`catalog-drafts/${id}/validate`, csrfToken, { method: "POST" });
export const publishCatalogDraft = (csrfToken: string, draft: CatalogDraft, changeNote: string) => catalogRequest<PublishedCatalog>(`catalog-drafts/${draft.id}/publish`, csrfToken, {
  method: "POST", body: JSON.stringify({ expectedRevision: draft.revision, definitionSha256: draft.definitionSha256, changeNote })
});
export const loadStationaryFormDraft = (csrfToken: string) => catalogRequest<StationaryFormDraft | null>("form-draft", csrfToken);
export const cloneStationaryFormDraft = (csrfToken: string, catalogReleaseId: string) => catalogRequest<StationaryFormDraft>("form-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ catalogReleaseId })
});
export const saveStationaryFormDraft = (csrfToken: string, draft: StationaryFormDraft) => catalogRequest<StationaryFormDraft>(`form-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, definition: draft.definition })
});

export const searchFormCatalog = (csrfToken: string, id: string, query: string, offset = 0) =>
  catalogRequest<FormCatalogElementPage>(`form-drafts/${id}/catalog-elements?query=${encodeURIComponent(query)}&offset=${offset}`, csrfToken);

export async function loadAdminContext(): Promise<AdminContext> {
  const response = await fetch(`${apiBaseUrl()}/api/admin/context`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Your account is not authorized to administer this installation."
      : "Administration configuration is unavailable.");
  }
  return response.json() as Promise<AdminContext>;
}
