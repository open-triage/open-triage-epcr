import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_WORKFLOW_ID = "demo-validation.yml";
const VALIDATION_JOB = "Required / Demo validation gate";
const PROVENANCE_JOB = "Authorize / Deployment provenance";

function requireSha(value, label) {
  if (!SHA_PATTERN.test(value ?? "")) {
    throw new Error(`${label} must be a full lowercase commit SHA.`);
  }
}

function requireRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value ?? "")) {
    throw new Error("GITHUB_REPOSITORY must be an owner/repository pair.");
  }
  return value.split("/").map(encodeURIComponent).join("/");
}

export function selectMergedPullRequest(pulls, { repository, targetSha, baseBranch = "main" }) {
  if (!Array.isArray(pulls)) throw new Error("GitHub returned invalid pull-request provenance.");

  const candidates = pulls.filter(
    (pull) =>
      pull?.state === "closed" &&
      typeof pull.merged_at === "string" &&
      pull.merge_commit_sha === targetSha &&
      pull.base?.ref === baseBranch &&
      pull.base?.repo?.full_name === repository &&
      pull.head?.sha,
  );

  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one merged pull request for ${targetSha} into ${baseBranch}; found ${candidates.length}.`,
    );
  }
  return candidates[0];
}

export function requireCurrentApproval(reviews, pull) {
  if (!Array.isArray(reviews)) throw new Error("GitHub returned invalid review provenance.");

  const mergedAt = Date.parse(pull.merged_at);
  if (!Number.isFinite(mergedAt)) throw new Error("GitHub returned an invalid pull-request merge time.");
  const latestDecisions = new Map();
  for (const review of reviews) {
    if (!review?.user?.login || !["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) {
      continue;
    }
    const submittedAt = Date.parse(review.submitted_at);
    if (!Number.isFinite(submittedAt) || submittedAt > mergedAt) continue;
    const previous = latestDecisions.get(review.user.login);
    if (!previous || Date.parse(previous.submitted_at) <= submittedAt) {
      latestDecisions.set(review.user.login, review);
    }
  }

  const approvals = [...latestDecisions.values()].filter(
    (review) => review.state === "APPROVED" && review.commit_id === pull.head.sha,
  );
  if (approvals.length === 0) {
    throw new Error(`Pull request #${pull.number} has no current approval for ${pull.head.sha}.`);
  }
}

async function githubJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new Error(`GitHub provenance API unavailable: ${error instanceof Error ? error.message : error}`);
  }
  if (!response.ok) {
    throw new Error(`GitHub provenance API returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("GitHub provenance API returned invalid JSON.");
  }
}

async function githubPages(fetchImpl, url, token, selectPage, label) {
  const values = [];
  const pageUrl = new URL(url);
  pageUrl.searchParams.set("per_page", "100");
  for (let page = 1; page <= 100; page += 1) {
    pageUrl.searchParams.set("page", String(page));
    const payload = await githubJson(fetchImpl, pageUrl, token);
    const pageValues = selectPage(payload);
    if (!Array.isArray(pageValues)) throw new Error(`GitHub returned invalid ${label}.`);
    values.push(...pageValues);
    if (pageValues.length < 100) return values;
  }
  throw new Error(`GitHub returned too much ${label} to establish unambiguous provenance.`);
}

export async function requireHistoricalValidation({
  apiUrl = DEFAULT_API_URL,
  fetchImpl = fetch,
  repository,
  runId,
  targetSha,
  token,
  workflowId = DEFAULT_WORKFLOW_ID,
}) {
  const repoPath = requireRepository(repository);
  const runsUrl = new URL(
    `${apiUrl}/repos/${repoPath}/actions/workflows/${encodeURIComponent(workflowId)}/runs`,
  );
  runsUrl.searchParams.set("branch", "main");
  runsUrl.searchParams.set("event", "push");
  runsUrl.searchParams.set("head_sha", targetSha);
  const runs = await githubPages(
    fetchImpl,
    runsUrl,
    token,
    (payload) => payload?.workflow_runs,
    "workflow-run validation evidence",
  );
  const candidates = runs.filter(
    (run) =>
      String(run.id) !== String(runId) &&
      run.event === "push" &&
      run.head_branch === "main" &&
      run.head_sha === targetSha,
  );
  let matchingRuns = 0;
  for (const run of candidates) {
    const jobs = await githubPages(
      fetchImpl,
      `${apiUrl}/repos/${repoPath}/actions/runs/${encodeURIComponent(run.id)}/jobs?per_page=100`,
      token,
      (payload) => payload?.jobs,
      "workflow-job validation evidence",
    );
    const successfulJobs = new Set(
      jobs.filter((job) => job.conclusion === "success").map((job) => job.name),
    );
    if (successfulJobs.has(VALIDATION_JOB) && successfulJobs.has(PROVENANCE_JOB)) {
      matchingRuns += 1;
    }
  }

  if (matchingRuns === 0) {
    throw new Error(`No prior authorized validation run matches ${targetSha}.`);
  }
}

export async function authorizeDemoDeployment({
  apiUrl = DEFAULT_API_URL,
  eventName,
  fetchImpl = fetch,
  repository,
  runId,
  targetSha,
  token,
  validatedSha,
  validationResult,
  workflowId = DEFAULT_WORKFLOW_ID,
}) {
  requireSha(targetSha, "Target revision");
  requireSha(validatedSha, "Validated revision");
  if (validatedSha !== targetSha || validationResult !== "success") {
    throw new Error("Successful validation evidence does not match the target revision.");
  }
  if (!token) throw new Error("GITHUB_TOKEN is required for deployment provenance.");
  const repoPath = requireRepository(repository);

  const pulls = await githubPages(
    fetchImpl,
    `${apiUrl}/repos/${repoPath}/commits/${targetSha}/pulls?per_page=100`,
    token,
    (payload) => payload,
    "pull-request provenance",
  );
  const pull = selectMergedPullRequest(pulls, { repository, targetSha });
  const reviews = await githubPages(
    fetchImpl,
    `${apiUrl}/repos/${repoPath}/pulls/${encodeURIComponent(pull.number)}/reviews?per_page=100`,
    token,
    (payload) => payload,
    "review provenance",
  );
  requireCurrentApproval(reviews, pull);

  if (eventName === "workflow_dispatch") {
    await requireHistoricalValidation({
      apiUrl,
      fetchImpl,
      repository,
      runId,
      targetSha,
      token,
      workflowId,
    });
  } else if (eventName !== "push") {
    throw new Error(`Deployment authorization is unavailable for ${eventName}.`);
  }

  return { pullNumber: pull.number, targetSha };
}

async function run() {
  const authorization = await authorizeDemoDeployment({
    apiUrl: process.env.GITHUB_API_URL,
    eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    targetSha: process.env.TARGET_REVISION,
    token: process.env.GITHUB_TOKEN,
    validatedSha: process.env.VALIDATED_REVISION,
    validationResult: process.env.VALIDATION_RESULT,
    workflowId: process.env.WORKFLOW_ID,
  });
  console.log(
    `Authorized deployment of ${authorization.targetSha} from approved pull request #${authorization.pullNumber}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
