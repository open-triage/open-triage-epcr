import { platformRequestError } from "./platform-errors";
import type { AdminCapabilityCatalog, AdminContext, AdminRole, AdminRoleHistory, AdminRoleList, AdminRoleSummaryList, AdminSessionList, AdminUserPage, AuthoringVersionOption, CancelOwnershipTransferCommand, CatalogDefinitionView, CatalogDraft, CatalogValidationResult, FormCatalogElementPage, InitiateOwnershipTransferCommand, OwnershipTransferState, ProvisionAdminUserCommand, ProvisionedAdminUser, PublishedCatalog, PublishedStationaryForm, PublishedValidationVersion, ReplaceAdminUserRolesCommand, ResetAdminCredentialCommand, ResetAdminCredentialResult, RevokedAdminSession, SaveAdminRoleCommand, StationaryFormActivation, StationaryFormDraft, UpdatedAdminUser, UpdatedAdminUserRoles, UpdateAdminUserCommand, ValidationActivation, ValidationDraft, ValidationDraftResult, ValidationRulePage, ValidationRuleSource } from "@open-triage/contracts";
import type { AgencyMediaSettings, UpdateAgencyMediaSettingsCommand } from "@open-triage/contracts";
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
  if (!response.ok) throw await platformRequestError(response);
  const responseText = await response.text();
  if (!responseText) {
    if (emptyResponse) return emptyResponse.value;
    throw new Error("The administration server returned an empty response.");
  }
  return JSON.parse(responseText) as T;
}

export const loadCatalogDraft = () => catalogRequest<CatalogDraft | null>("catalog-draft", undefined, undefined, { value: null });
export const loadCatalogVersions = () => catalogRequest<AuthoringVersionOption[]>("catalog-versions");
export const loadCatalogVersion = (id: string) => catalogRequest<CatalogDefinitionView>(`catalog-versions/${id}`);
export const loadActiveCatalogDefinition = () => catalogRequest<CatalogDefinitionView | null>("catalog-definition", undefined, undefined, { value: null });
export const cloneCatalogDraft = (csrfToken: string, displayName: string, sourceVersionId?: string) => catalogRequest<CatalogDraft>("catalog-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ displayName, sourceVersionId })
});
export const saveCatalogDraft = (csrfToken: string, draft: CatalogDraft) => catalogRequest<CatalogDraft>(`catalog-drafts/${draft.id}`, csrfToken, {
  method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, definition: draft.definition })
});
export const validateCatalogDraft = (csrfToken: string, id: string) => catalogRequest<CatalogValidationResult>(`catalog-drafts/${id}/validate`, csrfToken, { method: "POST" });
export const deleteCatalogDraft = (csrfToken: string, draft: CatalogDraft) => catalogRequest<void>(`catalog-drafts/${draft.id}`, csrfToken, {
  method: "DELETE", body: JSON.stringify({ expectedRevision: draft.revision })
}, { value: undefined });
export const publishCatalogDraft = (csrfToken: string, draft: CatalogDraft, displayName: string, changeNote: string) => catalogRequest<PublishedCatalog>(`catalog-drafts/${draft.id}/publish`, csrfToken, {
  method: "POST", body: JSON.stringify({ expectedRevision: draft.revision, definitionSha256: draft.definitionSha256, displayName, changeNote })
});
export const loadStationaryFormDraft = () => catalogRequest<StationaryFormDraft | null>("form-draft", undefined, undefined, { value: null });
export const loadStationaryFormVersions = () => catalogRequest<AuthoringVersionOption[]>("form-versions");
export const cloneStationaryFormDraft = (csrfToken: string, catalogReleaseId: string, displayName: string, sourceVersionId?: string) => catalogRequest<StationaryFormDraft>("form-drafts", csrfToken, {
  method: "POST", body: JSON.stringify({ catalogReleaseId, displayName, sourceVersionId })
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
export const activateStationaryForm = (csrfToken: string, formVersionId: string, validationVersionId: string, changeNote: string) =>
  catalogRequest<StationaryFormActivation>(`form-versions/${formVersionId}/activate`, csrfToken, {
    method: "POST", body: JSON.stringify({ validationVersionId, changeNote })
  });

export const searchFormCatalog = (id: string, query: string) =>
  catalogRequest<FormCatalogElementPage>(`form-drafts/${id}/catalog-elements?query=${encodeURIComponent(query)}`);

export const loadValidationDraft = () => catalogRequest<ValidationDraft | null>("validation-draft", undefined, undefined, { value: null });
export const loadValidationVersions = () => catalogRequest<AuthoringVersionOption[]>("validation-versions");
export const cloneValidationVersion = (csrfToken: string, sourceVersionId: string, catalogReleaseId: string, displayName: string) =>
  catalogRequest<ValidationDraft>(`validation-versions/${sourceVersionId}/clone`, csrfToken, {
    method: "POST", body: JSON.stringify({ catalogReleaseId, displayName })
  });
export type ValidationRuleQuery = { search?: string; element?: string; source?: string; severity?: string;
  executionTarget?: string; enabled?: string; validity?: string; cursor?: string; limit?: number | "all" };
export const loadValidationRules = (query: ValidationRuleQuery = {}) =>
  catalogRequest<ValidationRulePage>(`validation-rules${queryString(query as Record<string, string | number | undefined>)}`);
export const createValidationDraft = (csrfToken: string, catalogReleaseId: string, displayName: string) =>
  catalogRequest<ValidationDraft>("validation-drafts", csrfToken, {
    method: "POST", body: JSON.stringify({ catalogReleaseId, displayName })
  });
export const saveValidationDraft = (csrfToken: string, draft: ValidationDraft) =>
  catalogRequest<ValidationDraft>(`validation-drafts/${draft.id}`, csrfToken, {
    method: "PUT", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, rules: draft.rules })
  });
export const deleteValidationDraft = (csrfToken: string, draft: ValidationDraft) =>
  catalogRequest<void>(`validation-drafts/${draft.id}`, csrfToken, {
    method: "DELETE", body: JSON.stringify({ expectedRevision: draft.revision })
  }, { value: undefined });
export const createValidationRule = (csrfToken: string, draft: ValidationDraft, rule: Omit<ValidationRuleSource, "id">) =>
  catalogRequest<ValidationDraft>(`validation-drafts/${draft.id}/rules`, csrfToken, {
    method: "POST", body: JSON.stringify({ expectedRevision: draft.revision, ...rule })
  });
export const setValidationRuleEnabled = (csrfToken: string, draft: ValidationDraft, ruleId: string, enabled: boolean) =>
  catalogRequest<ValidationDraft>(`validation-drafts/${draft.id}/rules/${ruleId}/${enabled ? "restore" : "disable"}`, csrfToken, {
    method: "POST", body: JSON.stringify({ expectedRevision: draft.revision })
  });
export const validateValidationDraft = (csrfToken: string, id: string) =>
  catalogRequest<ValidationDraftResult>(`validation-drafts/${id}/validate`, csrfToken, { method: "POST" });
export const publishValidationDraft = (csrfToken: string, draft: ValidationDraft, changeNote: string) =>
  catalogRequest<PublishedValidationVersion>(`validation-drafts/${draft.id}/publish`, csrfToken, {
    method: "POST", body: JSON.stringify({ expectedRevision: draft.revision, displayName: draft.displayName, changeNote })
  });
export const activateValidationVersion = (csrfToken: string, id: string, formVersionId: string,
  catalogReleaseId: string, changeNote: string) =>
  catalogRequest<ValidationActivation>(`validation-versions/${id}/activate`, csrfToken, {
    method: "POST", body: JSON.stringify({ formVersionId, catalogReleaseId, changeNote })
  });

export async function loadAdminContext(): Promise<AdminContext> {
  const requestPath = "/api/admin/context";
  const configuration = browserRequestConfiguration();
  if (configuration.mode === "static" && !configuration.routeStaticMutationsToApi) {
    throw new Error("Administration is unavailable in the static demonstration.");
  }
  const url = apiRequestUrl(requestPath, configuration) ?? browserRouteUrl(requestPath, configuration);
  const response = await fetch(url, browserRequestInit());
  if (!response.ok) {
    throw await platformRequestError(response);
  }
  return response.json() as Promise<AdminContext>;
}

export const loadAgencyMediaSettings = () => catalogRequest<AgencyMediaSettings>("agency-settings");
export const updateAgencyMediaSettings = (csrfToken: string, command: UpdateAgencyMediaSettingsCommand) =>
  catalogRequest<AgencyMediaSettings>("agency-settings", csrfToken, {
    method: "PUT", body: JSON.stringify(command)
  });

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

export const loadAdminRoleCapabilities = () => catalogRequest<AdminCapabilityCatalog>("role-capabilities");

export const createAdminRole = (csrfToken: string, command: SaveAdminRoleCommand) =>
  catalogRequest<AdminRole>("roles", csrfToken, { method: "POST", body: JSON.stringify(command) });

export const updateAdminRole = (csrfToken: string, roleId: string, command: SaveAdminRoleCommand) =>
  catalogRequest<AdminRole>(`roles/${roleId}`, csrfToken, { method: "PUT", body: JSON.stringify(command) });

export const deactivateAdminRole = (csrfToken: string, roleId: string, expectedVersion: number, note?: string | null) =>
  catalogRequest<AdminRole>(`roles/${roleId}/deactivate`, csrfToken, {
    method: "POST", body: JSON.stringify({ expectedVersion, note: note || null })
  });

export const reactivateAdminRole = (csrfToken: string, roleId: string, command: SaveAdminRoleCommand) =>
  catalogRequest<AdminRole>(`roles/${roleId}/reactivate`, csrfToken, { method: "POST", body: JSON.stringify(command) });

export const loadAdminRoleHistory = (roleId: string) => catalogRequest<AdminRoleHistory>(`roles/${roleId}/history`);

export const loadAdminUserRoleOptions = () => catalogRequest<AdminRoleSummaryList>("user-role-options");

export const provisionAdminUser = (csrfToken: string, command: ProvisionAdminUserCommand) =>
  catalogRequest<ProvisionedAdminUser>("users", csrfToken, { method: "POST", body: JSON.stringify(command) });

export const updateAdminUser = (csrfToken: string, userId: string, command: UpdateAdminUserCommand) =>
  catalogRequest<UpdatedAdminUser>(`users/${userId}`, csrfToken, { method: "PUT", body: JSON.stringify(command) });

export const replaceAdminUserRoles = (csrfToken: string, userId: string, command: ReplaceAdminUserRolesCommand) =>
  catalogRequest<UpdatedAdminUserRoles>(`users/${userId}/roles`, csrfToken,
    { method: "PUT", body: JSON.stringify(command) });

export const loadAdminUserSessions = (userId: string) =>
  catalogRequest<AdminSessionList>(`users/${userId}/sessions`);

export const revokeAdminUserSession = (csrfToken: string, userId: string, sessionId: string,
  confirmOwner = false) => catalogRequest<RevokedAdminSession>(`users/${userId}/sessions/${sessionId}`, csrfToken,
  { method: "DELETE", body: JSON.stringify(confirmOwner ? { confirmOwner: true } : {}) });

export const resetAdminUserCredential = (csrfToken: string, userId: string, command: ResetAdminCredentialCommand) =>
  catalogRequest<ResetAdminCredentialResult>(`users/${userId}/credentials/reset`, csrfToken,
    { method: "POST", body: JSON.stringify(command) });

export const loadOwnershipTransfer = () => catalogRequest<OwnershipTransferState>("ownership-transfer");
export const initiateOwnershipTransfer = (csrfToken: string, command: InitiateOwnershipTransferCommand) =>
  catalogRequest<OwnershipTransferState>("ownership-transfer", csrfToken,
    { method: "POST", body: JSON.stringify(command) });
export const acceptOwnershipTransfer = (csrfToken: string) =>
  catalogRequest<OwnershipTransferState>("ownership-transfer/accept", csrfToken, { method: "POST" });
export const cancelOwnershipTransfer = (csrfToken: string, command: CancelOwnershipTransferCommand = {}) =>
  catalogRequest<OwnershipTransferState>("ownership-transfer", csrfToken,
    { method: "DELETE", body: JSON.stringify(command) });
