import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { localRouting } from "../apps/web/scripts/lib/local-routing.mjs";

async function listen(t, handler) {
  const server = createServer(handler).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}
function call(port, host, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: options.method || "GET",
      headers: { host, ...options.headers } }, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(options.body);
  });
}

test("shared local edge preserves agency identity, bodies, cookies and API paths", async (t) => {
  const upstream = await listen(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(201, { "set-cookie": "session=value; HttpOnly; Path=/" });
    res.end(JSON.stringify({ host: req.headers.host, origin: req.headers.origin, forwarded: req.headers["x-forwarded-host"],
      cookie: req.headers.cookie, method: req.method, url: req.url, body }));
  });
  const route = localRouting({ OPEN_TRIAGE_API_UPSTREAM: `http://127.0.0.1:${upstream}` });
  const port = await listen(t, (req, res) => { if (!route(req, res)) res.end(req.url); });
  for (const host of ["localhost:3000", "demo.localhost:3000", "another.localhost:3000"]) {
    const response = await call(port, host, "/api/sessions?continue=1", {
      method: "POST", body: "payload", headers: { origin: `http://${host}`, cookie: "session=old", "x-forwarded-host": "spoof.test" },
    });
    assert.equal(response.status, 201);
    assert.deepEqual(response.headers["set-cookie"], ["session=value; HttpOnly; Path=/"]);
    assert.deepEqual(JSON.parse(response.body), { host, origin: `http://${host}`, cookie: "session=old", method: "POST", url: "/api/sessions?continue=1", body: "payload" });
    const get = await call(port, host, "/api/installation");
    assert.equal(JSON.parse(get.body).host, host, "GET without Origin retains the agency host");
  }
});

test("landing selection is configurable and does not expose the app service worker", async (t) => {
  const route = localRouting({ OPEN_TRIAGE_PUBLIC_SITE_HOST: "public.localhost" });
  const port = await listen(t, (req, res) => { if (!route(req, res)) res.end(req.url); });
  assert.equal((await call(port, "public.localhost:3000", "/")).body, "/landing/index.html");
  assert.equal((await call(port, "public.localhost:3000", "/site.css")).body, "/landing/site.css");
  assert.equal((await call(port, "public.localhost:3000", "/sw.js")).status, 404);
  assert.equal((await call(port, "agency.localhost:3000", "/")).body, "/");
  const disabled = localRouting({ OPEN_TRIAGE_PUBLIC_SITE_HOST: "" });
  const disabledPort = await listen(t, (req, res) => { if (!disabled(req, res)) res.end(req.url); });
  assert.equal((await call(disabledPort, "localhost:3000", "/")).body, "/");
});

test("unavailable API returns 502 and invalid upstreams fail at startup", async (t) => {
  const route = localRouting({ OPEN_TRIAGE_API_UPSTREAM: "http://127.0.0.1:1" });
  const port = await listen(t, route);
  assert.equal((await call(port, "agency.localhost", "/api/health")).status, 502);
  for (const upstream of ["file:///tmp/test", "http://user:secret@localhost", "http://localhost/api"]) {
    assert.throws(() => localRouting({ OPEN_TRIAGE_API_UPSTREAM: upstream }), /HTTP\(S\) origin/);
  }
});
