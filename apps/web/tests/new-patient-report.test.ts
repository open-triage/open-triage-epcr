import assert from "node:assert/strict";
import test from "node:test";
import type { ClinicianSession } from "@open-triage/contracts";
import { createNewPatientReport } from "../app/assigned-calls";
import { customElementKey, customElementIdentifier } from "../components/catalog-authoring";

const session = { user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "Agency" },
  csrfToken: "csrf-proof", startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  capabilities: ["clinical:document"], workspaceAvailable: true } as ClinicianSession;

test("New patient creates an unknown-identity report against the active form and opens it", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests: Array<{ url: string; method?: string; body?: Record<string, string> }> = [];
  const reportId = "42000000-0000-4000-8000-000000000011";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), method: init?.method, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json(requests.length === 1 ? { id: reportId } : { callNumber: "New patient · 42000000", report: { id: reportId } });
  };
  const opened = await createNewPatientReport(session);
  assert.equal(opened.report.id, reportId);
  assert.match(requests[0]!.url, /\/api\/reports$/);
  assert.equal(requests[0]!.method, "POST");
  assert.equal(requests[0]!.body!.patientIdentityState, "unknown");
  assert.equal(requests[0]!.body!.organizationId, session.organization.id);
  assert.equal(requests[0]!.body!.documentingUserId, session.user.id);
  assert.equal(requests[0]!.body!.formId, undefined);
  assert.match(requests[1]!.url, /\/api\/reports\/42000000-0000-4000-8000-000000000011\/reopen$/);
});


test("shared custom namespace keeps identical visible IDs distinct across organizations", () => {
  const first = customElementKey("32000000-0000-4000-8000-000000000001", "Outcome");
  const second = customElementKey("32000000-0000-4000-8000-000000000002", "Outcome");
  assert.notEqual(first, second);
  assert.equal(customElementIdentifier("32000000-0000-4000-8000-000000000001", first), "Outcome");
});
