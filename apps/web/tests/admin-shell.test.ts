import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type ClinicianSession } from "@open-triage/contracts";
import { acceptOwnershipTransfer, activateStationaryForm, activateValidationVersion, cancelOwnershipTransfer, createAdminRole, createValidationRule, deactivateAdminRole, deleteCatalogDraft, deleteStationaryFormDraft, initiateOwnershipTransfer, loadActiveCatalogDefinition, loadAdminContext, loadAdminRoleHistory, loadAdminRoles, loadAdminUsers, loadAdminUserSessions, loadCatalogDraft, loadOwnershipTransfer, loadStationaryFormDraft, loadValidationRules, provisionAdminUser, publishStationaryFormDraft, publishValidationDraft, reactivateAdminRole, replaceAdminUserRoles, resetAdminUserCredential, revokeAdminUserSession, saveCatalogDraft, saveStationaryFormDraft, searchFormCatalog, setValidationRuleEnabled, updateAdminRole, updateAdminUser } from "../app/admin-context";
import { reauthenticateClinicianSession } from "../app/clinician-session";
import { AdminShell } from "../components/admin-shell";
import { RoleCapabilityMatrix, roleDraftFindings, RolesPanel, UsersPanel } from "../components/admin-directory";
import { catalogAuthority, CatalogCodeListEditor, moveCodeValue } from "../components/catalog-authoring";
import { addFormElement, FormElementPicker, FormSectionElements, moveFormElement, removeFormElement } from "../components/form-authoring";
import { affectedFieldNames, formAuthority, formStructuralSummary, moveFormSection, removeFormSection, StationaryFormAuthoring } from "../components/stationary-form-authoring";
import { configuredStationaryPreviewSections } from "../app/stationary-record";
import { syntheticEncounter } from "../app/standard-encounter";
import { createStationaryPreviewDocument, stationaryPreviewFindings, StationaryFormPreview } from "../components/stationary-form-preview";
import { ValidationReferenceAssistance, ValidationResultFeedback, ValidationRuleFilterControls } from "../components/validation-authoring";
import { deleteValidationDraft } from "../app/admin-context";
import { formSectionLabel } from "../components/form-authoring";
import { groupValidationDiagnostics } from "../components/validation-authoring";

const session: ClinicianSession = {
  csrfToken: "csrf",
  user: { id: "owner-id", displayName: "Installation Owner" },
  organization: { id: "organization-id", name: "Example EMS" },
  startedAt: "2026-09-06T12:00:00.000Z",
  expiresAt: "2026-09-06T20:00:00.000Z",
  capabilities: ["admin-dashboard:read", "catalog:read", "catalog:write", "catalog:publish",
    "forms:read", "forms:write", "forms:publish", "clinical:document"]
};
test("Admin navigation waits for server-authorized panels", () => {
  const markup = renderToStaticMarkup(createElement(AdminShell, { session }));
  assert.match(markup, /aria-labelledby="admin-heading"/);
  assert.match(markup, /class="admin-tabs"/);
  assert.match(markup, /class="loading-status admin-loading" role="status"/);
  assert.doesNotMatch(markup, /Loading active configuration/, "fast initialization does not flash loading copy");
  assert.doesNotMatch(markup, />Users<\/button>|>Roles<\/button>|>Element catalog<\/button>/);
});

test("read-only directory panels expose accessible discovery controls without mutation actions", () => {
  const users = renderToStaticMarkup(createElement(UsersPanel));
  assert.match(users, /role="search"/);
  assert.match(users, /type="search"/);
  assert.match(users, />Status<select/);
  assert.match(users, />Role<select/);
  assert.doesNotMatch(users, /<button[^>]*>(Create|Edit|Disable|Assign)/);
  const roles = renderToStaticMarkup(createElement(RolesPanel));
  assert.match(roles, /id="roles-heading"/);
  assert.match(roles, />Deactivated<\/option>/);
  assert.doesNotMatch(roles, /<button[^>]*>(Create|Edit|Delete)/);
});

test("user writers receive an accessible provisioning form with bounded temporary expiry and complete roles", () => {
  const users = renderToStaticMarkup(createElement(UsersPanel, { canCreate: true, csrfToken: "csrf" }));
  assert.match(users, />Create user<\/button>/);
  assert.match(users, /aria-controls="create-user-form"/);
  assert.doesNotMatch(users, /name="temporaryPassword"/, "closed form does not expose or retain a password input");
});

test("provisioning sends the complete credential command with CSRF and consumes a secret-free result", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      username: "medic.one", displayName: "Medic One", temporaryPassword: "Temporary password 42!",
      temporaryPasswordHours: 72, roleIds: ["role-id"], note: "New starter"
    });
    return Response.json({ userId: "user-id", username: "medic.one", displayName: "Medic One",
      roleIds: ["role-id"], temporaryPasswordExpiresAt: "2026-09-14T10:00:00.000Z" });
  };
  const created = await provisionAdminUser("csrf-proof", { username: "medic.one", displayName: "Medic One",
    temporaryPassword: "Temporary password 42!", temporaryPasswordHours: 72,
    roleIds: ["role-id"], note: "New starter" });
  assert.equal(created.userId, "user-id");
  assert.equal("temporaryPassword" in created, false);
});

test("directory requests encode server-side filters and pagination", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json(requests.length === 1 ? { items: [], nextCursor: null, pageSize: 50 } : { items: [] });
  };
  await loadAdminUsers({ search: "Alex Smith", state: "disabled", roleId: "role-id", cursor: "opaque", limit: 50 });
  await loadAdminRoles("all");
  assert.match(requests[0]!, /users\?search=Alex\+Smith&state=disabled&roleId=role-id&cursor=opaque&limit=50$/);
  assert.match(requests[1]!, /roles\?state=all$/);
});

test("Validation library requests expose all filters and revisioned create, disable, and restore commands", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const draft = { id: "51000000-0000-4000-8000-000000000001", catalogReleaseId: "catalog", clonedFromId: null, revision: 4,
    displayName: "Rules", rules: [], updatedAt: "2026-09-18T00:00:00Z" };
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json(requests.length === 1 ? { items: [], nextCursor: null, total: 0 } : { ...draft, revision: draft.revision + requests.length });
  };
  await loadValidationRules({ search: "incident number", element: "eResponse.03", source: "nemsis", severity: "warning",
    executionTarget: "sign", enabled: "false", validity: "invalid", cursor: "opaque", limit: 25 });
  await loadValidationRules({ source: "nemsis", limit: "all" });
  const rule = { name: "Agency incident rule", enabled: false, severity: "warning" as const,
    executionTargets: ["live" as const], primaryTargetElementId: "eResponse.03", message: "Review incident number",
    source: 'require present("eResponse.03")', sourceKind: "agency" as const };
  await createValidationRule("csrf-proof", draft, rule);
  await setValidationRuleEnabled("csrf-proof", draft, "52000000-0000-4000-8000-000000000001", false);
  await setValidationRuleEnabled("csrf-proof", draft, "52000000-0000-4000-8000-000000000001", true);
  assert.match(requests[0]!.input, /validation-rules\?search=incident\+number&element=eResponse\.03&source=nemsis&severity=warning&executionTarget=sign&enabled=false&validity=invalid&cursor=opaque&limit=25$/);
  assert.match(requests[1]!.input, /validation-rules\?source=nemsis&limit=all$/);
  assert.match(requests[2]!.input, /validation-drafts\/51000000-0000-4000-8000-000000000001\/rules$/);
  assert.equal(JSON.parse(String(requests[2]!.init?.body)).expectedRevision, 4);
  assert.match(requests[3]!.input, /\/disable$/);
  assert.match(requests[4]!.input, /\/restore$/);
  assert.ok(requests.slice(2).every(({ init }) => (init?.headers as Record<string, string>)["x-csrf-token"] === "csrf-proof"));
});

test("Validation rule-library filters expose an accessible search landmark and every supported facet", () => {
  const markup = renderToStaticMarkup(createElement(ValidationRuleFilterControls, { value: {
    search: "", element: "", source: "", severity: "", executionTarget: "", enabled: "", validity: "",
  }, onChange() {} }));
  assert.match(markup, /role="search" aria-label="Filter Validation rules"/);
  for (const label of ["Search", "Element", "Source", "Severity", "Target", "State", "Validity"]) {
    assert.match(markup, new RegExp(`>${label}(?:<| )`));
  }
  assert.match(markup, /type="search"/);
  assert.match(markup, />NEMSIS<\/option>/);
  assert.match(markup, />Disabled<\/option>/);
  assert.match(markup, />Invalid<\/option>/);
  assert.match(markup, /Element <select/);
  assert.doesNotMatch(markup, /validation-element-references/);
});

test("Validation element reference uses a scrollable native dropdown", () => {
  const markup = renderToStaticMarkup(createElement(ValidationReferenceAssistance, {
    catalog: { elements: [{ elementId: "ePatient.01", label: "Name", baseDatatype: "string" }], codes: [] },
    elementId: "ePatient.01", onElementIdChange() {},
  }));
  assert.match(markup, /<select id="validation-reference-element"/);
  assert.match(markup, /ePatient\.01 — Name/);
  assert.doesNotMatch(markup, /<datalist id="validation-element-references"/);
});

test("Validation feedback keeps the draft-wide explanation collapsed and summarizes issues", () => {
  const success = renderToStaticMarkup(createElement(ValidationResultFeedback, { ruleCount: 198, result: {
    valid: true, diagnostics: [], explanation: "Long explanation for all rules in the draft",
  } }));
  assert.match(success, /Validation passed.<\/strong> 198 rules checked/);
  assert.match(success, /<details><summary>View details<\/summary>/);
  assert.doesNotMatch(success, /<details open/);
  const failure = renderToStaticMarkup(createElement(ValidationResultFeedback, { ruleCount: 4, result: {
    valid: false, diagnostics: [1, 2, 3, 4].map((number) => ({ ruleId: `rule-${number}`, code: "syntax" as const,
      severity: "error" as const, message: `Issue ${number}` })),
  } }));
  assert.match(failure, /Validation found 4 issues/);
  assert.match(failure, /Show all 4 issues/);
  assert.equal((failure.match(/<li>/g) ?? []).length, 3, "closed issue details do not render the entire rule library");
});

test("validation feedback deduplicates identical messages without losing rule references or counts", () => {
  const diagnostics = ["rule-one", "rule-two", "rule-two"].map((ruleId) => ({ ruleId, code: "syntax" as const,
    severity: "warning" as const, message: "Review this rule" }));
  assert.deepEqual(groupValidationDiagnostics(diagnostics), [{ code: "syntax", severity: "warning",
    message: "Review this rule", count: 3, ruleIds: ["rule-one", "rule-two"] }]);
  const markup = renderToStaticMarkup(createElement(ValidationResultFeedback, {
    ruleCount: 2, result: { valid: true, diagnostics },
  }));
  assert.match(markup, /3 warnings/);
  assert.match(markup, /1 distinct messages/);
  assert.doesNotMatch(markup, /<li>/);
});

test("validation deletion accepts empty 200 and 204 success and still surfaces conflicts", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", catalogReleaseId: "catalog-id", clonedFromId: null, revision: 4,
    displayName: "Test rules", rules: [], updatedAt: "2026-09-28T12:00:00Z" };
  for (const status of [200, 204]) {
    globalThis.fetch = async (input, init) => {
      assert.match(String(input), /validation-drafts\/draft-id$/);
      assert.equal(init?.method, "DELETE");
      assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4 });
      return new Response(null, { status });
    };
    await deleteValidationDraft("csrf-proof", draft);
  }
  globalThis.fetch = async () => Response.json({ code: "admin.http409", params: {}, message: "Draft revision is stale" }, { status: 409 });
  await assert.rejects(deleteValidationDraft("csrf-proof", draft), /information changed/);
});

test("role editor explains prerequisite validation and protects capabilities outside the actor's authority", () => {
  const options = [
    { key: "users:read", description: "View users", administrative: true, systemOnly: false,
      prerequisites: [], mutable: false },
    { key: "users:write", description: "Change users", administrative: true, systemOnly: false,
      prerequisites: ["users:read"], mutable: true }
  ];
  assert.deepEqual(roleDraftFindings({ displayName: "Dispatch", description: "", note: "",
    capabilityKeys: ["users:write"] }, options), ["users:write requires users:read."]);
  const markup = renderToStaticMarkup(createElement(RolesPanel,
    { csrfToken: "csrf", capabilities: ["roles:read", "roles:write"] }));
  assert.match(markup, /Create custom role/);
});

test("role capabilities render as rows with roles as columns", () => {
  const roles = [{ id: "clinician", displayName: "Clinician", description: "Documents care", active: true,
    protected: true, version: 1, assigneeCount: 4,
    capabilities: [{ key: "clinical:document", description: "Document patient care", administrative: false,
      systemOnly: false }] },
  { id: "administrator", displayName: "Administrator", description: null, active: true,
    protected: true, version: 2, assigneeCount: 1,
    capabilities: [{ key: "users:read", description: "View users", administrative: true, systemOnly: false }] }];
  const options = [
    { key: "clinical:document", description: "Document patient care", administrative: false, systemOnly: false,
      prerequisites: [], mutable: true },
    { key: "users:read", description: "View users", administrative: true, systemOnly: false,
      prerequisites: [], mutable: true }
  ];
  const markup = renderToStaticMarkup(createElement(RoleCapabilityMatrix, { roles, capabilityOptions: options,
    canWrite: false, onHistory: () => undefined, onEdit: () => undefined, onDeactivate: () => undefined,
    onReactivate: () => undefined }));
  assert.match(markup, /<caption>Capabilities assigned to each role<\/caption>/);
  assert.match(markup, /<th scope="col">Capability<\/th><th scope="col"><span class="admin-role-column-heading"[^>]*><strong>Clinician/);
  assert.match(markup, /<th scope="row"[^>]*><code>clinical:document<\/code>/);
  assert.match(markup, /title="Document patient care"/);
  assert.doesNotMatch(markup, /<small>Document patient care<\/small>/);
  assert.match(markup, /capability-included[^>]*><span class="admin-capability-mark" aria-hidden="true">✓<\/span>/);
  assert.match(markup, /capability-not-included[^>]*><span class="admin-capability-mark" aria-hidden="true">—<\/span>/);
  assert.doesNotMatch(markup, />Edit<\/button>|>Deactivate<\/button>/);
});

test("role mutations send CSRF proof and optimistic version without mutable audit details", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return Response.json({ id: "role-id", displayName: "Dispatch", description: null, active: true,
      protected: false, version: requests.length, assigneeCount: 0, capabilities: [] });
  };
  const definition = { displayName: "Dispatch", description: null, capabilityKeys: ["roles:read"], note: "Reviewed" };
  await createAdminRole("csrf-proof", definition);
  await updateAdminRole("csrf-proof", "role-id", { ...definition, expectedVersion: 1 });
  assert.equal(requests[0]!.init?.method, "POST");
  assert.equal((requests[0]!.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
  assert.equal(requests[1]!.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { ...definition, expectedVersion: 1 });
  assert.doesNotMatch(String(requests[1]!.init?.body), /password|token|secret/i);
});

test("user lifecycle updates send the expected revision without accepting a partial role update", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/admin\/users\/user-id$/);
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7, username: "renamed.user",
      displayName: "Renamed User", active: false, note: "Leave" });
    return Response.json({ id: "user-id", username: "renamed.user", displayName: "Renamed User", active: false,
      revision: 8, roles: [], restoredRoles: [], sessionsRevoked: 3, freshLoginRequired: true });
  };
  const updated = await updateAdminUser("csrf-proof", "user-id", { expectedRevision: 7,
    username: "renamed.user", displayName: "Renamed User", active: false, note: "Leave" });
  assert.equal(updated.sessionsRevoked, 3);
});

test("role lifecycle requests carry version preconditions and read redacted history separately", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (String(input).endsWith("/history")) return Response.json({ roleId: "role-id", versions: [], assignments: [], events: [] });
    return Response.json({ id: "role-id", displayName: "Dispatch", description: null,
      active: requests.length > 1, protected: false, version: requests.length > 1 ? 4 : 3,
      assigneeCount: 0, capabilities: [] });
  };
  await deactivateAdminRole("csrf-proof", "role-id", 3, "Duty retired");
  await reactivateAdminRole("csrf-proof", "role-id", { displayName: "Dispatch", description: null,
    capabilityKeys: ["roles:read"], expectedVersion: 3, note: null });
  await loadAdminRoleHistory("role-id");
  assert.match(requests[0]!.input, /roles\/role-id\/deactivate$/);
  assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), { expectedVersion: 3, note: "Duty retired" });
  assert.match(requests[1]!.input, /roles\/role-id\/reactivate$/);
  assert.equal((requests[1]!.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
  assert.equal(requests[2]!.init?.method, undefined);
});

test("role replacement and protected-action reauthentication use separate revisioned requests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    return requests.length === 1
      ? Response.json({ reauthenticatedUntil: "2026-09-11T12:05:00.000Z" })
      : Response.json({ id: "user-id", username: "user", displayName: "User", active: false,
        revision: 9, roles: [], addedRoles: [], removedRoles: [] });
  };
  const assurance = await reauthenticateClinicianSession("current password", "csrf-proof");
  await replaceAdminUserRoles("csrf-proof", "user-id", { expectedRevision: 8, roleIds: [], note: "Prepare" });
  assert.equal(assurance.reauthenticatedUntil, "2026-09-11T12:05:00.000Z");
  assert.match(requests[0]!.input, /\/api\/sessions\/reauthenticate$/);
  assert.deepEqual(JSON.parse(String(requests[0]!.init?.body)), { currentPassword: "current password" });
  assert.match(requests[1]!.input, /\/api\/admin\/users\/user-id\/roles$/);
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)),
    { expectedRevision: 8, roleIds: [], note: "Prepare" });
  assert.equal((requests[1]!.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
});

test("ownership transfer requests expose pending state and preserve CSRF on every command", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const state = { owner: { id: "owner-id", displayName: "Owner" }, currentUserIsOwner: true,
    currentUserIsNominee: false, transfer: null, eligibleNominees: [{ id: "nominee-id", displayName: "Nominee" }] };
  globalThis.fetch = async (input, init) => { requests.push({ input: String(input), init }); return Response.json(state); };
  await loadOwnershipTransfer();
  await initiateOwnershipTransfer("csrf-proof", { nomineeUserId: "nominee-id", note: "Succession" });
  await acceptOwnershipTransfer("csrf-proof");
  await cancelOwnershipTransfer("csrf-proof", { note: "Changed plan" });
  assert.match(requests[0]!.input, /ownership-transfer$/);
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { nomineeUserId: "nominee-id", note: "Succession" });
  assert.match(requests[2]!.input, /ownership-transfer\/accept$/);
  assert.equal(requests[3]!.init?.method, "DELETE");
  for (const request of requests.slice(1)) {
    assert.equal((request.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
  }
});

test("session and reset requests preserve CSRF, owner confirmation, revision, and secret-free responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init });
    if (requests.length === 1) return Response.json({ userId: "user-id", items: [{ id: "session-id",
      startedAt: "2026-09-11T08:00:00.000Z", lastActivityAt: "2026-09-11T09:00:00.000Z",
      expiresAt: "2026-09-11T20:00:00.000Z", deviceLabel: "Firefox on Linux", current: true, owner: true }] });
    if (requests.length === 2) return Response.json({ sessionId: "session-id", revoked: true,
      alreadyRevoked: false, currentSessionRevoked: true });
    return Response.json({ userId: "user-id", revision: 8, active: false,
      temporaryPasswordExpiresAt: "2026-09-12T12:00:00.000Z", sessionsRevoked: 2 });
  };
  const viewed = await loadAdminUserSessions("user-id");
  assert.deepEqual(viewed.items[0], { id: "session-id", startedAt: "2026-09-11T08:00:00.000Z",
    lastActivityAt: "2026-09-11T09:00:00.000Z", expiresAt: "2026-09-11T20:00:00.000Z",
    deviceLabel: "Firefox on Linux", current: true, owner: true });
  assert.doesNotMatch(JSON.stringify(viewed), /source.?ip|geolocation/i);
  await revokeAdminUserSession("csrf-proof", "user-id", "session-id", true);
  const reset = await resetAdminUserCredential("csrf-proof", "user-id", { expectedRevision: 7,
    temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 24, note: "Lost device" });
  assert.equal(requests[1]!.init?.method, "DELETE");
  assert.deepEqual(JSON.parse(String(requests[1]!.init?.body)), { confirmOwner: true });
  assert.equal((requests[1]!.init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
  assert.deepEqual(JSON.parse(String(requests[2]!.init?.body)), { expectedRevision: 7,
    temporaryPassword: "Replacement password 84!", temporaryPasswordHours: 24, note: "Lost device" });
  assert.equal(reset.active, false, "credential reset remains separate from account reactivation");
  assert.equal("temporaryPassword" in reset, false);
});

test("Admin context reports direct authorization failures without trusting client claims", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  await assert.rejects(loadAdminContext(), /legacy.http401/);
});

test("nullable admin draft endpoints accept an empty successful response", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, { status: 200 });
  assert.equal(await loadCatalogDraft(), null);
  assert.equal(await loadActiveCatalogDefinition(), null);
  assert.equal(await loadStationaryFormDraft(), null);
});

test("catalog saves send the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", displayName: "Agency Catalog", sourceReleaseId: "release-id", revision: 7,
    definitionSha256: "a".repeat(64), updatedAt: "2026-09-06T12:00:00.000Z",
    definition: { schemaVersion: 1 as const, sourceReleaseId: "release-id", elements: [], codeLists: [] } };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7, displayName: "Agency Catalog", definition: draft.definition });
    return Response.json({ ...draft, revision: 8 });
  };
  assert.equal((await saveCatalogDraft("csrf-proof", draft)).revision, 8);
});

test("catalog deletion sends CSRF proof and the current revision", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", sourceReleaseId: "release-id", revision: 7,
    definitionSha256: "a".repeat(64), updatedAt: "2026-09-06T12:00:00.000Z",
    definition: { schemaVersion: 1 as const, sourceReleaseId: "release-id", elements: [], codeLists: [] } };
  globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/api\/admin\/catalog-drafts\/draft-id$/);
    assert.equal(init?.method, "DELETE");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 7 });
    return new Response(null, { status: 204 });
  };
  await deleteCatalogDraft("csrf-proof", draft);
});

const codeList = { listId: "activity", name: "Patient Activity", classification: "suggested" as const,
  elementIds: ["eSituation.01"], defaultValue: null, values: [
    { code: "ONE", codeSystem: "LOCAL", label: "First", sourceLabel: "First", category: null, enabled: true },
    { code: "TWO", codeSystem: "LOCAL", label: "Second", sourceLabel: "Second", category: null, enabled: true }
  ] };

test("code-list controls expose labeled editing, state, default, and keyboard-operable ordering", () => {
  const markup = renderToStaticMarkup(createElement(CatalogCodeListEditor, { list: codeList, onChange: () => {} }));
  assert.match(markup, /<legend>Add value<\/legend>/);
  assert.match(markup, /aria-label="Move First up"/);
  assert.match(markup, /aria-label="Move Second down"/);
  assert.equal((markup.match(/Enabled<\/label>/g) ?? []).length, 2);
  assert.equal((markup.match(/Default<\/label>/g) ?? []).length, 2);
});

test("accessible move controls reorder values without changing code identity", () => {
  const moved = moveCodeValue(codeList, 1, 0);
  assert.deepEqual(moved.values.map(({ code }) => code), ["TWO", "ONE"]);
  assert.equal(moveCodeValue(codeList, 0, -1), codeList);
});

test("Catalog authority requires the complete read-write-publish prerequisite chain", () => {
  assert.deepEqual(catalogAuthority(["catalog:read"]), { canRead: true, canWrite: false, canPublish: false });
  assert.deepEqual(catalogAuthority(["catalog:read", "catalog:write"]),
    { canRead: true, canWrite: true, canPublish: false });
  assert.deepEqual(catalogAuthority(["catalog:read", "catalog:write", "catalog:publish"]),
    { canRead: true, canWrite: true, canPublish: true });
  assert.deepEqual(catalogAuthority(["catalog:write"]), { canRead: false, canWrite: false, canPublish: false });
  assert.deepEqual(catalogAuthority(["catalog:publish"]), { canRead: false, canWrite: false, canPublish: false });
});

test("read-only code-list inspection exposes definitions without mutable controls", () => {
  const markup = renderToStaticMarkup(createElement(CatalogCodeListEditor,
    { list: codeList, readOnly: true, onChange: () => assert.fail("read-only control mutated") }));
  assert.equal((markup.match(/<input[^>]*disabled=""/g) ?? []).length, 10);
  assert.equal((markup.match(/<button type="button" disabled=""/g) ?? []).length, 6);
});

const formDefinition = { schemaVersion: 1 as const, sections: [
  { key: "patient", fields: [
    { key: "name", source: { kind: "nemsis" as const, elementId: "ePatient.02" } },
    { key: "age", source: { kind: "nemsis" as const, elementId: "ePatient.15" } }
  ] },
  { key: "assessment", fields: [{ key: "impression", source: { kind: "nemsis" as const, elementId: "eSituation.11" } }] }
] };
const catalogElement = { elementId: "ePatient.01", name: "Patient Care Report Number",
  description: "The patient care report number.", baseDatatype: "string", groupPath: ["ePatient"] };

test("section operations preserve canonical content while changing only section scope and sequence", () => {
  const moved = moveFormSection(formDefinition, 1, 0);
  assert.deepEqual(moved.sections.map(({ key }) => key), ["assessment", "patient"]);
  assert.deepEqual(moved.sections[0]?.fields, formDefinition.sections[1]?.fields);
  assert.deepEqual(affectedFieldNames(formDefinition.sections[0]!), ["name (ePatient.02)", "age (ePatient.15)"]);
  const removed = removeFormSection(formDefinition, 0);
  assert.deepEqual(removed.sections.map(({ key }) => key), ["assessment"]);
  assert.throws(() => removeFormSection(removed, 0), /at least one section/);
});

test("live form section controls expose named keyboard-operable move and removal actions", () => {
  const markup = renderToStaticMarkup(createElement(StationaryFormAuthoring, {
    csrfToken: "csrf", capabilities: session.capabilities ?? [], catalogReleaseId: "catalog-id",
  }));
  assert.match(markup, /role="status"/);
  assert.doesNotMatch(markup, /Loading Stationary form draft/);
  const controls = renderToStaticMarkup(createElement(FormSectionElements, { definition: formDefinition,
    onChange: () => {}, onMoveSection: () => {}, onRequestRemoveSection: () => {} }));
  assert.match(controls, /aria-label="Move patient down"/);
  assert.match(controls, /aria-label="Move assessment up"/);
  assert.match(controls, /aria-label="Remove patient"/);
  assert.match(controls, /aria-label="Remove assessment"/);
});

test("Forms authority requires the complete read-write-publish prerequisite chain", () => {
  assert.deepEqual(formAuthority(["forms:read"]), { canRead: true, canWrite: false, canPublish: false });
  assert.deepEqual(formAuthority(["forms:read", "forms:write"]),
    { canRead: true, canWrite: true, canPublish: false });
  assert.deepEqual(formAuthority(["forms:read", "forms:write", "forms:publish"]),
    { canRead: true, canWrite: true, canPublish: true });
  assert.deepEqual(formAuthority(["forms:write"]), { canRead: false, canWrite: false, canPublish: false });
  assert.deepEqual(formAuthority(["forms:publish"]), { canRead: false, canWrite: false, canPublish: false });
});

test("draft preview projects only configured sections and fields through Stationary groups", () => {
  const sections = configuredStationaryPreviewSections(formDefinition);
  assert.deepEqual(sections.map(({ label }) => label), ["patient", "assessment"]);
  assert.deepEqual(sections[0]!.blocks.flatMap(({ elementIds }) => elementIds), ["ePatient.02", "ePatient.15"]);
  assert.deepEqual(sections[1]!.blocks.flatMap(({ elementIds }) => elementIds), ["eSituation.11"]);
  const included = sections.flatMap(({ blocks }) => blocks.flatMap(({ elementIds }) => elementIds));
  assert.equal(included.includes("ePatient.01"), false);
});

test("Stationary preview is interactive, explicitly ephemeral, and leaves the fixture detached", () => {
  const baseline = structuredClone(syntheticEncounter.document);
  const previewDocument = createStationaryPreviewDocument();
  assert.notStrictEqual(previewDocument, syntheticEncounter.document);
  assert.deepEqual(syntheticEncounter.document, baseline);
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: formDefinition, diagnostics: [],
    catalogFields: { "eSituation.11": { agencyRequired: false, minOccurs: 0, maxOccurs: 1, nillable: true,
      supportsNotValues: true, supportsPertinentNegatives: false,
      codeChoices: [
        { code: "R10.0", codeSystem: "ICD-10-CM", label: "Acute pain" },
        { code: "AGENCY-1", codeSystem: "LOCAL", label: "Agency custom choice" }
      ] } },
    updatedAt: "2026-09-07T01:00:00.000Z" };
  const markup = renderToStaticMarkup(createElement(StationaryFormPreview, { draft, onReturn() {} }));
  assert.match(markup, /Interactive fictional data only/);
  assert.match(markup, /Return to form draft/);
  assert.match(markup, /aria-label="Complete stationary NEMSIS record"/);
  assert.match(markup, /data-element-id="ePatient\.02"/);
  assert.match(markup, /Acute pain/);
  assert.match(markup, /Agency custom choice/);
  assert.doesNotMatch(markup, /data-element-id="ePatient\.01"/);
});

test("preview validation is scoped to included fields and honors an explicit optional override", () => {
  const document = createStationaryPreviewDocument();
  const groups = document.groups.map((group) => ({ ...group, instances: group.instances.map((instance) => ({
    ...instance,
    elements: instance.elements.map((element) => element.id === "ePatient.15" ? { ...element, values: [] } : element),
  })) }));
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: { schemaVersion: 1 as const, sections: [{ key: "patient", fields: [
      { key: "age", source: { kind: "nemsis" as const, elementId: "ePatient.15" }, required: false }
    ] }] }, diagnostics: [], updatedAt: "2026-09-07T01:00:00.000Z" };
  assert.equal(stationaryPreviewFindings({ ...document, groups }, draft).some((finding) => finding.target.fieldId === "ePatient.15"), false);
});

test("form saves send section order with the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: moveFormSection(formDefinition, 1, 0), diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "PUT");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4, displayName: "Night Shift Form", definition: draft.definition });
    return Response.json({ ...draft, revision: 5 });
  };
  assert.equal((await saveStationaryFormDraft("csrf-proof", draft)).revision, 5);
});

test("form deletion sends the current revision and CSRF proof", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const draft = { id: "draft-id", displayName: "Night Shift Form", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: formDefinition, diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "DELETE");
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4 });
    return new Response(null, { status: 200 });
  };
  await deleteStationaryFormDraft("csrf-proof", draft);
});

test("form review summarizes structure and publication stays separate from activation", async (t) => {
  assert.equal(formStructuralSummary(formDefinition), "2 sections and 3 elements");
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    paths.push(String(input));
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    if (String(input).endsWith("/form-drafts/draft-id/publish")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 4,
        definitionSha256: "a".repeat(64), displayName: "Night Shift Form", changeNote: "Reviewed" });
      return Response.json({ id: "draft-id", status: "published" });
    }
    assert.deepEqual(JSON.parse(String(init?.body)), { validationVersionId: "validation-id", changeNote: "Deploy" });
    return Response.json({ formVersionId: "draft-id" });
  };
  const draft = { id: "draft-id", formId: "form-id", catalogReleaseId: "catalog-id", clonedFromId: "source-id",
    revision: 4, definitionSha256: "a".repeat(64), definition: formDefinition, diagnostics: [],
    updatedAt: "2026-09-07T01:00:00.000Z" };
  await publishStationaryFormDraft("csrf-proof", draft, "Night Shift Form", "Reviewed");
  assert.equal(paths.length, 1, "publication did not activate the form");
  await activateStationaryForm("csrf-proof", "draft-id", "validation-id", "Deploy");
  assert.match(paths[1]!, /form-versions\/draft-id\/activate$/);
});

test("Validation publication and activation are separate browser commands", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    paths.push(String(input));
    assert.equal((init?.headers as Record<string, string>)["x-csrf-token"], "csrf-proof");
    if (String(input).includes("/validation-drafts/")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { expectedRevision: 3, displayName: "Agency required fields", changeNote: "Reviewed" });
      return Response.json({ id: "51000000-0000-4000-8000-000000000001", status: "published" });
    }
    assert.deepEqual(JSON.parse(String(init?.body)), { formVersionId: "form-id", catalogReleaseId: "catalog",
      changeNote: "Activate reviewed rule" });
    return Response.json({ validationVersionId: "51000000-0000-4000-8000-000000000001" });
  };
  const draft = { id: "51000000-0000-4000-8000-000000000001", catalogReleaseId: "catalog", clonedFromId: null, revision: 3,
    displayName: "Agency required fields", rules: [{ id: "52000000-0000-4000-8000-000000000001",
      name: "Require incident number", enabled: true, severity: "error" as const,
      executionTargets: ["live" as const, "sign" as const], primaryTargetElementId: "eResponse.03",
      message: "Incident number is required", source: 'assert present("eResponse.03")' }], updatedAt: new Date().toISOString() };
  await publishValidationDraft("csrf-proof", draft, "Reviewed");
  assert.equal(paths.length, 1);
  await activateValidationVersion("csrf-proof", draft.id, "form-id", "catalog", "Activate reviewed rule");
  assert.match(paths[1]!, /validation-versions\/.*\/activate$/);
});

test("Validation reference assistance shows mutable labels while retaining stable element and code identifiers", () => {
  const markup = renderToStaticMarkup(createElement(ValidationReferenceAssistance, { elementId: "eSituation.13",
    onElementIdChange() {}, catalog: { elements: [
      { elementId: "eSituation.13", label: "Primary Symptom", baseDatatype: "string" },
    ], codes: [
      { elementId: "eSituation.13", codeSystem: "SNOMED-CT", code: "267036007", label: "Dyspnea", enabled: true },
    ] } }));
  assert.match(markup, /value="eSituation\.13"/);
  assert.match(markup, /Primary Symptom/);
  assert.match(markup, /value="SNOMED-CT\|267036007"/);
  assert.match(markup, /Dyspnea/);
  assert.match(markup, /stores stable element IDs, code systems, and codes/);
});

test("form catalog picker is searchable, labels duplicates, and exposes an add control", () => {
  const markup = renderToStaticMarkup(createElement(FormElementPicker, { definition: formDefinition,
    results: [catalogElement, { ...catalogElement, elementId: "ePatient.02", name: "Last Name" }], query: "patient",
    targetSection: "patient", onQueryChange() {}, onSectionChange() {}, onAdd() {} }));
  assert.match(markup, /type="search"/);
  assert.match(markup, /aria-label="Add ePatient.01"/);
  assert.match(markup, /ePatient.02 is already in the form/);
  assert.match(markup, /Already added/);
});

test("form editor initially renders one section and bounds search result rows", () => {
  const markup = renderToStaticMarkup(createElement(FormSectionElements, { definition: formDefinition, onChange() {} }));
  assert.match(markup, /Go to section/);
  assert.match(markup, /ePatient\.02/);
  assert.doesNotMatch(markup, /eSituation\.11/);
  assert.equal((markup.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal(formSectionLabel({ key: "ePatient", fields: [] }), "Patient");
  assert.equal(formSectionLabel({ key: "eResponseSection", fields: [] }), "Response");
  const props = { definition: formDefinition, results: Array.from({ length: 100 }, (_, index) => ({
    ...catalogElement, elementId: `eTest.${index}`,
  })), targetSection: "patient", onQueryChange() {}, onSectionChange() {}, onAdd() {} };
  const blank = renderToStaticMarkup(createElement(FormElementPicker, { ...props, query: "" }));
  assert.match(blank, /Search the catalog to add an element/);
  assert.doesNotMatch(blank, /<li>/);
  const search = renderToStaticMarkup(createElement(FormElementPicker, { ...props, query: "test" }));
  assert.equal((search.match(/<li>/g) ?? []).length, 20);
  assert.match(search, /Show more elements/);
});

test("form element helpers prevent duplicates and add, remove, and reorder immutably", () => {
  const original = structuredClone(formDefinition);
  const added = addFormElement(formDefinition, "patient", catalogElement);
  assert.deepEqual(added.sections[0]!.fields.map((field) => field.source.kind === "nemsis" && field.source.elementId),
    ["ePatient.02", "ePatient.15", "ePatient.01"]);
  assert.throws(() => addFormElement(added, "patient", catalogElement), /already in the form/);
  const moved = moveFormElement(added, "patient", 2, 0);
  assert.equal(moved.sections[0]!.fields[0]!.key, "ePatient.01");
  assert.deepEqual(removeFormElement(moved, "patient", "ePatient.01"), formDefinition);
  assert.deepEqual(formDefinition, original);
});

test("form element rows provide keyboard-operable move and confirmed remove controls", () => {
  const markup = renderToStaticMarkup(createElement(FormSectionElements, { definition: formDefinition, onChange() {} }));
  assert.match(markup, /aria-label="Move ePatient.02 up"/);
  assert.match(markup, /aria-label="Move ePatient.15 down"/);
  assert.match(markup, /aria-label="Remove ePatient.02"/);
  assert.match(markup, /aria-expanded="true"/);
  assert.match(markup, /<small>Last Name<\/small>/);
});

test("read-only form inspection exposes the definition without mutation controls", () => {
  const markup = renderToStaticMarkup(createElement(FormSectionElements,
    { definition: formDefinition, readOnly: true, onChange: () => assert.fail("read-only control mutated") }));
  assert.match(markup, /ePatient\.02/);
  assert.doesNotMatch(markup, /Actions for ePatient\.02/);
  assert.doesNotMatch(markup, /Remove ePatient\.02/);
});

test("form search sends the searchable query without pagination", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (input) => {
    assert.match(String(input), /catalog-elements\?query=patient%20name$/);
    return Response.json({ items: [], nextOffset: null });
  };
  await searchFormCatalog("draft-id", "patient name");
});
