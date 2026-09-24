import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { authorizeDemoDeployment } from "../scripts/require-demo-provenance.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const sha = "0123456789abcdef0123456789abcdef01234567";
const headSha = "89abcdef0123456789abcdef0123456789abcdef";
const repository = "open-triage/open-triage-epcr";

function mergedPull(overrides = {}) {
  return {
    number: 506,
    state: "closed",
    merged_at: "2026-09-24T10:00:00Z",
    merge_commit_sha: sha,
    base: { ref: "main", repo: { full_name: repository } },
    head: { sha: headSha },
    ...overrides,
  };
}

function approval(overrides = {}) {
  return {
    state: "APPROVED",
    commit_id: headSha,
    submitted_at: "2026-09-24T09:00:00Z",
    user: { login: "reviewer" },
    ...overrides,
  };
}

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

function fetchSequence(...responses) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected request");
    return response;
  };
  return { calls, fetchImpl };
}

function authorize(options = {}) {
  return authorizeDemoDeployment({
    browserValidationResult: "success",
    eventName: "push",
    repository,
    runId: "901",
    targetSha: sha,
    token: "test-token",
    validatedSha: sha,
    validationResult: "success",
    ...options,
  });
}

test("an approved merged pull request with matching validation is eligible", async () => {
  const { fetchImpl } = fetchSequence(jsonResponse([mergedPull()]), jsonResponse([approval()]));

  assert.deepEqual(await authorize({ fetchImpl }), { pullNumber: 506, targetSha: sha });
});

test("a direct push is ineligible even after diagnostics pass", async () => {
  const { fetchImpl } = fetchSequence(jsonResponse([]));

  await assert.rejects(authorize({ fetchImpl }), /exactly one merged pull request/);
});

test("mismatched or stale evidence is rejected", async () => {
  const unusedFetch = async () => {
    throw new Error("API must not be queried for mismatched validation");
  };
  await assert.rejects(
    authorize({ fetchImpl: unusedFetch, validatedSha: "f".repeat(40) }),
    /does not match/,
  );
  await assert.rejects(
    authorize({ browserValidationResult: "failure", fetchImpl: unusedFetch }),
    /does not match/,
  );

  const staleApproval = fetchSequence(
    jsonResponse([mergedPull()]),
    jsonResponse([approval({ commit_id: "a".repeat(40) })]),
  );
  await assert.rejects(authorize({ fetchImpl: staleApproval.fetchImpl }), /no current approval/);
});

test("ambiguous or unavailable provenance fails closed", async () => {
  const ambiguous = fetchSequence(jsonResponse([mergedPull(), mergedPull({ number: 507 })]));
  await assert.rejects(authorize({ fetchImpl: ambiguous.fetchImpl }), /found 2/);

  const unavailable = fetchSequence(new Error("network unavailable"));
  await assert.rejects(authorize({ fetchImpl: unavailable.fetchImpl }), /API unavailable/);
});

test("manual redeployment requires prior matching validation and provenance jobs", async () => {
  const eligible = fetchSequence(
    jsonResponse([mergedPull()]),
    jsonResponse([approval()]),
    jsonResponse({
      workflow_runs: [{ id: 900, event: "push", head_branch: "main", head_sha: sha }],
    }),
    jsonResponse({
      jobs: [
        { name: "Required / Demo validation gate", conclusion: "success" },
        { name: "Validate / Complete browser suite", conclusion: "success" },
        { name: "Authorize / Deployment provenance", conclusion: "success" },
      ],
    }),
  );

  assert.deepEqual(
    await authorize({ eventName: "workflow_dispatch", fetchImpl: eligible.fetchImpl }),
    { pullNumber: 506, targetSha: sha },
  );
  assert.match(eligible.calls[2], new RegExp(`head_sha=${sha}`));

  const wrongRevision = fetchSequence(
    jsonResponse([mergedPull()]),
    jsonResponse([approval()]),
    jsonResponse({
      workflow_runs: [{ id: 900, event: "push", head_branch: "main", head_sha: "f".repeat(40) }],
    }),
  );
  await assert.rejects(
    authorize({ eventName: "workflow_dispatch", fetchImpl: wrongRevision.fetchImpl }),
    /No prior authorized validation run matches/,
  );
});

test("the authorization job is the only path from validation to registry mutation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const authorization = workflow.slice(
    workflow.indexOf("  deployment-authorization:"),
    workflow.indexOf("  publish-images:"),
  );
  const publishing = workflow.slice(
    workflow.indexOf("  publish-images:"),
    workflow.indexOf("  publish-image-manifest:"),
  );

  assert.match(authorization, /^    needs: \[validation-gate, browser-e2e-validation\]$/m);
  assert.match(authorization, /^      actions: read$/m);
  assert.match(authorization, /^      pull-requests: read$/m);
  assert.match(authorization, /node scripts\/require-demo-provenance\.mjs/);
  assert.match(authorization, /BROWSER_VALIDATION_RESULT: \$\{\{ needs\.browser-e2e-validation\.result \}\}/);
  assert.match(publishing, /^    needs: deployment-authorization$/m);
  assert.match(publishing, /needs\.deployment-authorization\.result == 'success'/);
  assert.doesNotMatch(
    workflow.slice(workflow.indexOf("  web-deployment-validation:"), workflow.indexOf("  deployment-authorization:")),
    /docker push|docker\/login-action|packages: write/,
  );
});
