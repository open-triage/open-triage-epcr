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
