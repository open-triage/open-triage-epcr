import { fileURLToPath } from "node:url";
import fixture from "../packages/contracts/src/synthetic-demo-fixture.json" with { type: "json" };
import productionSettings from "../packages/contracts/config/installation.production.json" with { type: "json" };

const DEFAULT_USERNAME = fixture.username;
const DEFAULT_PASSWORD = fixture.password;
const LEGACY_DEMO_CREDENTIAL = { username: "demo.admin", password: "open-triage-demo" };

function httpsUrl(label, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

async function request(fetchImpl, label, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    // Do not include request details: authenticated calls contain a bearer token.
    throw new Error(`${label} request failed`);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return response;
}

async function responseJson(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an invalid response`);
  }
}

function verifySecurityHeaders(response, label) {
  const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
  if (!/(?:^|;)\s*default-src\s+'none'(?:\s*;|$)/i.test(contentSecurityPolicy) ||
      !/(?:^|;)\s*frame-ancestors\s+'none'(?:\s*;|$)/i.test(contentSecurityPolicy) ||
      /'unsafe-(?:inline|eval)'/i.test(contentSecurityPolicy)) {
    throw new Error(`${label} returned an invalid Content-Security-Policy`);
  }
  if (response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff") {
    throw new Error(`${label} did not disable content-type sniffing`);
  }
  if (response.headers.get("referrer-policy")?.toLowerCase() !== "strict-origin-when-cross-origin") {
    throw new Error(`${label} returned an invalid Referrer-Policy`);
  }
  const permissions = response.headers.get("permissions-policy")?.toLowerCase() ?? "";
  for (const [feature, allowlist] of [["camera", "self"], ["microphone", "self"], ["geolocation", ""]]) {
    if (!new RegExp(`(?:^|,)\\s*${feature}=\\(${allowlist}\\)(?:\\s*,|$)`).test(permissions)) {
      throw new Error(`${label} returned an invalid Permissions-Policy`);
    }
  }
  if (response.headers.get("x-frame-options")?.toUpperCase() !== "DENY") {
    throw new Error(`${label} did not prevent framing for legacy clients`);
  }
  const hsts = response.headers.get("strict-transport-security") ?? "";
  const maxAge = /(?:^|;)\s*max-age=(\d+)(?:\s*;|$)/i.exec(hsts)?.[1];
  if (!maxAge || Number(maxAge) !== 31_536_000 || !/(?:^|;)\s*includesubdomains(?:\s*;|$)/i.test(hsts) ||
      /(?:^|;)\s*preload(?:\s*;|$)/i.test(hsts)) {
    throw new Error(`${label} returned an invalid Strict-Transport-Security policy`);
  }
}

async function retry(operation, { attempts, delayMilliseconds }) {
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      failure = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
      }
    }
  }
  throw failure;
}

export async function verifyPublicDemo(
  {
    frontendUrl,
    apiUrl,
    username,
    password,
    readinessAttempts = 12,
    readinessDelayMilliseconds = 10_000,
  },
  { fetchImpl = globalThis.fetch, log = console.log } = {},
) {
  const frontend = httpsUrl("DEMO_WEB_URL", frontendUrl);
  const api = httpsUrl("DEMO_API_URL", apiUrl);
  const explicitlyConfigured = username !== undefined || password !== undefined;
  if (explicitlyConfigured && (!username || !password)) {
    throw new Error("Synthetic login credentials are required");
  }
  const credentialCandidates = explicitlyConfigured
    ? [{ username, password }]
    : [{ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD }, LEGACY_DEMO_CREDENTIAL];

  await retry(async () => {
    const response = await request(fetchImpl, "Frontend HTTPS", frontend);
    verifySecurityHeaders(response, "Frontend HTTPS");
    const body = await response.text();
    if (!body.includes("OpenTriage synthetic encounter")) {
      throw new Error("Frontend HTTPS returned an unexpected response");
    }
  }, { attempts: readinessAttempts, delayMilliseconds: readinessDelayMilliseconds });
  log("PASS frontend HTTPS, certificate, and security-header verification");

  await retry(async () => {
    const response = await request(fetchImpl, "API health", new URL("/api/health", api));
    verifySecurityHeaders(response, "API health");
    const health = await responseJson(response, "API health");
    if (health?.status !== "ok" || health?.service !== "open-triage-api") {
      throw new Error("API health returned an unexpected response");
    }
  }, { attempts: readinessAttempts, delayMilliseconds: readinessDelayMilliseconds });
  log("PASS public API health and security-header verification");

  const installationResponse = await request(fetchImpl, "Installation configuration", new URL("/api/installation", api));
  const installation = await responseJson(installationResponse, "Installation configuration");
  if (JSON.stringify(installation?.settings) !== JSON.stringify(productionSettings) ||
      "profile" in installation || "demoLogin" in installation || "fixture" in installation) {
    throw new Error("Public demo installation configuration is inconsistent");
  }
  log("PASS production-equivalent installation policy");

  let loginResponse;
  for (const [index, candidate] of credentialCandidates.entries()) {
    try {
      loginResponse = await request(fetchImpl, "Synthetic login", new URL("/api/sessions", api), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(candidate),
      });
      break;
    } catch (error) {
      if (index === credentialCandidates.length - 1 || error.message !== "Synthetic login returned HTTP 401") {
        throw error;
      }
    }
  }
  if (!loginResponse) throw new Error("Synthetic login did not return a response");
  await responseJson(loginResponse, "Synthetic login");
  const sessionCookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
  if (!sessionCookie?.startsWith("open_triage_session="))
    throw new Error("Synthetic login did not establish a session cookie");
  log("PASS synthetic login");

  const assignedResponse = await request(fetchImpl, "Authenticated read", new URL("/api/calls/assigned", api), {
    headers: { cookie: sessionCookie },
  });
  const assigned = await responseJson(assignedResponse, "Authenticated read");
  if (!Array.isArray(assigned?.assignedCalls) || !Array.isArray(assigned?.canceledAssignmentIds)) {
    throw new Error("Authenticated read returned an unexpected response");
  }
  log("PASS authenticated assigned-calls read");
}

async function main() {
  const username = process.env.DEMO_SMOKE_USERNAME;
  const password = process.env.DEMO_SMOKE_PASSWORD;
  await verifyPublicDemo({
    frontendUrl: process.env.DEMO_WEB_URL,
    apiUrl: process.env.DEMO_API_URL,
    ...(username !== undefined || password !== undefined ? { username, password } : {}),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Demo smoke verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
