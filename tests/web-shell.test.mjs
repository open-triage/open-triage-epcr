import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { verifyWebShell } from "../scripts/verify-web-shell.mjs";

test("the HTTP shell check rejects MIME failures that prevent Android startup", async () => {
  let invalid;
  const paths = [];
  const server = createServer((request, response) => {
    const path = request.url;
    paths.push(path);
    const type = path === invalid ? "application/octet-stream" : {
      "/": "text/html", "/sw.js": "application/javascript", "/manifest.webmanifest": "application/manifest+json",
      "/_next/static/app.js": "text/javascript", "/_next/static/app.css": "text/css",
    }[path];
    response.setHeader("Content-Type", type);
    response.end(path === "/" ? '<script src="/_next/static/app.js"></script><link href="/_next/static/app.css">' : path === "/manifest.webmanifest" ? '{}' : 'fixture');
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await verifyWebShell(origin);
    assert.deepEqual(new Set(paths), new Set(["/", "/sw.js", "/manifest.webmanifest", "/_next/static/app.js", "/_next/static/app.css"]));
    for (invalid of ["/manifest.webmanifest", "/sw.js", "/_next/static/app.js", "/_next/static/app.css"]) {
      await assert.rejects(verifyWebShell(origin), /Invalid public UI resource.*application\/octet-stream/);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
