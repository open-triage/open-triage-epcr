import assert from "node:assert/strict";
import test from "node:test";
import {
  apiRequestUrl,
  browserRequestConfiguration,
  browserRequestInit,
  browserRouteUrl,
} from "../app/browser-api";

test("server-backed browser requests use the configured API and cookie credentials", () => {
  const configuration = browserRequestConfiguration({
    NEXT_PUBLIC_API_URL: "https://api.example.test/",
    NEXT_PUBLIC_BASE_PATH: "/demo/",
  });

  assert.deepEqual(configuration, {
    mode: "server",
    apiBaseUrl: "https://api.example.test",
    basePath: "/demo",
    routeStaticMutationsToApi: false,
  });
  assert.equal(apiRequestUrl("/api/reports/open", configuration), "https://api.example.test/api/reports/open");
  assert.deepEqual(browserRequestInit(), { cache: "no-store", credentials: "include" });
});

test("intentional static mode uses base-path assets and exposes mutation routing explicitly", () => {
  const configuration = browserRequestConfiguration({
    NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION: "true",
    NEXT_PUBLIC_API_URL: "https://ignored.example.test",
    NEXT_PUBLIC_BASE_PATH: "/published-demo/",
    NEXT_PUBLIC_ROUTE_DEMO_MUTATIONS_TO_API: "true",
  });

  assert.deepEqual(configuration, {
    mode: "static",
    apiBaseUrl: null,
    basePath: "/published-demo",
    routeStaticMutationsToApi: true,
  });
  assert.equal(apiRequestUrl("/api/reports/open", configuration), null);
  assert.equal(browserRouteUrl("/demo-open-calls.json", configuration), "/published-demo/demo-open-calls.json");
});

test("same-origin hosting keeps requests on the selected agency hostname", () => {
  const configuration = browserRequestConfiguration({ NEXT_PUBLIC_API_URL: "same-origin" });
  assert.equal(configuration.mode, "server");
  assert.equal(apiRequestUrl("/api/sessions/current", configuration), "/api/sessions/current");
});

test("another tab cannot redirect a rendered agency's requests through localStorage", async () => {
  const { bindBrowserOrganization } = await import("../app/browser-api");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  let stored = JSON.stringify({ organization: { id: "parent" } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => stored } } });
  try {
    assert.equal(new Headers(browserRequestInit().headers).get("x-organization-id"), "parent");
    stored = JSON.stringify({ organization: { id: "child" } });
    assert.equal(new Headers(browserRequestInit().headers).get("x-organization-id"), "parent");
    bindBrowserOrganization("child");
    assert.equal(new Headers(browserRequestInit().headers).get("x-organization-id"), "child");
  } finally {
    bindBrowserOrganization(undefined);
    if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("local agency API requests retain the subdomain and configured API port", async () => {
  const { localAgencyApiUrl } = await import("../app/browser-api");
  assert.equal(localAgencyApiUrl("http://localhost:3001", "demo.localhost"), "http://demo.localhost:3001");
  assert.equal(localAgencyApiUrl("http://127.0.0.1:4001", "test.localhost"), "http://test.localhost:4001");
  for (const host of ["localhost", "demo.localhost.evil.test", "demo.example.org"]) {
    assert.equal(localAgencyApiUrl("http://localhost:3001", host), "http://localhost:3001");
  }
  assert.equal(localAgencyApiUrl("https://api.example.org", "demo.localhost"), "https://api.example.org");
  assert.equal(localAgencyApiUrl("", "demo.localhost"), "");
});


test("portable builds default to same-origin without a compiled hostname", () => {
  assert.equal(apiRequestUrl("/api/installation", browserRequestConfiguration({})), "/api/installation");
});
