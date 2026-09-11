import { fileURLToPath } from "node:url";
import fixture from "../packages/contracts/src/synthetic-demo-fixture.json" with { type: "json" };
import productionSettings from "../packages/contracts/config/installation.production.json" with { type: "json" };

const DEFAULT_USERNAME = fixture.administratorUsername;
const DEFAULT_PASSWORD = fixture.password;

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
    username = DEFAULT_USERNAME,
    password = DEFAULT_PASSWORD,
    readinessAttempts = 12,
    readinessDelayMilliseconds = 10_000,
  },
  { fetchImpl = globalThis.fetch, log = console.log } = {},
) {
  const frontend = httpsUrl("DEMO_WEB_URL", frontendUrl);
  const api = httpsUrl("DEMO_API_URL", apiUrl);
  if (!username || !password) throw new Error("Synthetic login credentials are required");

  await retry(async () => {
    const response = await request(fetchImpl, "Frontend HTTPS", frontend);
    const body = await response.text();
    if (!body.includes("OpenTriage synthetic encounter")) {
      throw new Error("Frontend HTTPS returned an unexpected response");
    }
  }, { attempts: readinessAttempts, delayMilliseconds: readinessDelayMilliseconds });
  log("PASS frontend HTTPS and certificate verification");

  await retry(async () => {
    const response = await request(fetchImpl, "API health", new URL("/api/health", api));
    const health = await responseJson(response, "API health");
    if (health?.status !== "ok" || health?.service !== "open-triage-api") {
      throw new Error("API health returned an unexpected response");
    }
  }, { attempts: readinessAttempts, delayMilliseconds: readinessDelayMilliseconds });
  log("PASS public API health");

  const installationResponse = await request(fetchImpl, "Installation configuration", new URL("/api/installation", api));
  const installation = await responseJson(installationResponse, "Installation configuration");
  if (JSON.stringify(installation?.settings) !== JSON.stringify(productionSettings) ||
      "profile" in installation || "demoLogin" in installation || "fixture" in installation ||
      JSON.stringify(installation).includes(fixture.password)) {
    throw new Error("Public demo installation configuration is inconsistent");
  }
  log("PASS production-equivalent installation policy without exposed fixture credentials");

  const loginResponse = await request(fetchImpl, "Synthetic login", new URL("/api/sessions", api), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
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
  await verifyPublicDemo({
    frontendUrl: process.env.DEMO_WEB_URL,
    apiUrl: process.env.DEMO_API_URL,
    username: process.env.DEMO_SMOKE_USERNAME || DEFAULT_USERNAME,
    password: process.env.DEMO_SMOKE_PASSWORD || DEFAULT_PASSWORD,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Demo smoke verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
