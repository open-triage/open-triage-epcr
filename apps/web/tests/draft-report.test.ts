import assert from "node:assert/strict";
import test from "node:test";
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_SYNC_RETRY_MS,
  draftChangesUrl,
  saveDraftReport,
  signDraftReport,
  shellStateToDraftMutations,
  stableDraftId,
} from "../app/draft-report";
import { INITIAL_SHELL_STATE, transitionShell } from "../app/standard-encounter";

const reportId = "42000000-0000-4000-8000-000000000013";

test("the draft adapter retains stable report, group, and occurrence identities", () => {
  const first = shellStateToDraftMutations(reportId, INITIAL_SHELL_STATE);
  const second = shellStateToDraftMutations(reportId, structuredClone(INITIAL_SHELL_STATE));
  assert.deepEqual(second, first);
  assert.match(stableDraftId(reportId, "group:patient-1"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(first.groups.map(({ id }) => id)).size, first.groups.length);
  assert.equal(new Set(first.occurrences.map(({ id }) => id)).size, first.occurrences.length);
  assert.equal(DRAFT_SAVE_DEBOUNCE_MS, 1_000);
  assert.equal(DRAFT_SYNC_RETRY_MS, 2_000);
});

test("signing sends the current revision, clinician attestation, and warning acknowledgements", async () => {
  const originalFetch = globalThis.fetch;
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalLocalDemoSession = process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  let request: { input: string; init?: RequestInit } | undefined;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ id: reportId, status: "signed" }), { status: 201 });
  }) as typeof fetch;
  try {
    await signDraftReport("token", reportId, 8, "32000000-0000-4000-8000-000000000003", ["missing-vitals"]);
    const body = JSON.parse(String(request?.init?.body));
    assert.equal(request?.input, `http://localhost:3001/api/reports/${reportId}/sign`);
    assert.equal(request?.init?.method, "POST");
    assert.equal(body.expectedRevision, 8);
    assert.equal(body.signerId, "32000000-0000-4000-8000-000000000003");
    assert.deepEqual(body.warningAcknowledgements, { "missing-vitals": true });
    assert.equal(body.attestation.meaning, "clinician approval");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBasePath === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    if (originalLocalDemoSession === undefined) delete process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION;
    else process.env.NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION = originalLocalDemoSession;
  }
});

test("timeline edits become typed revisioned API mutations without changing their identities", () => {
  let shell = transitionShell(INITIAL_SHELL_STATE, { type: "note-started", id: "note-1", date: "2026-09-03", time: "12:01" });
  shell = transitionShell(shell, { type: "note-draft-changed", field: "summary", value: "Patient reassessed" });
  shell = transitionShell(shell, { type: "note-saved" });
  const first = shellStateToDraftMutations(reportId, shell);
  const note = first.occurrences.find(({ elementId }) => elementId === "eNarrative.01");
  assert.deepEqual(note?.value, { kind: "text", value: "Patient reassessed" });

  shell = transitionShell(shell, { type: "note-opened", id: "note-1" });
  shell = transitionShell(shell, { type: "note-draft-changed", field: "summary", value: "Patient reassessed; pain improved" });
  shell = transitionShell(shell, { type: "note-saved" });
  const updated = shellStateToDraftMutations(reportId, shell).occurrences.find(({ elementId }) => elementId === "eNarrative.01");
  assert.equal(updated?.id, note?.id);
  assert.deepEqual(updated?.value, { kind: "text", value: "Patient reassessed; pain improved" });
});

test("the web adapter sends bearer-authenticated commands to the report draft endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ id: reportId, revision: 8, status: "draft" }), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await saveDraftReport("token", reportId, {
      commandId: "52000000-0000-4000-8000-000000000013", expectedRevision: 7,
      authorId: "32000000-0000-4000-8000-000000000003", deviceId: "web:test",
      clientTime: "2026-09-03T12:00:00.000Z", groups: [], occurrences: [],
    });
    assert.equal(result.revision, 8);
    assert.equal(request?.input, draftChangesUrl(reportId));
    assert.equal(request?.init?.method, "POST");
    assert.equal((request?.init?.headers as Record<string, string>).authorization, "Bearer token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
