import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  contentSecurityPolicy,
  generateNginxConfig,
  inlineScriptHashes,
} from "../deploy/docker/generate-nginx-config.mjs";

test("web CSP authorizes exported inline scripts by hash without unsafe directives", async () => {
  const directory = await mkdtemp(join(tmpdir(), "open-triage-csp-"));
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "index.html"), "<script>bootstrap()</script><script src='/app.js'></script>");
  await writeFile(join(directory, "nested", "index.html"), "<script>hydrate()</script>");

  const hashes = await inlineScriptHashes(directory);
  const policy = contentSecurityPolicy(hashes, "https://api.example.test/path");

  assert.equal(hashes.length, 2);
  assert.match(policy, /script-src 'self' 'sha256-/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.example\.test/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});

test("generated nginx config contains the restrictive CSP and browser hardening headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "open-triage-nginx-"));
  const exportDirectory = join(directory, "out");
  await mkdir(exportDirectory);
  await writeFile(join(exportDirectory, "index.html"), "<script>bootstrap()</script>");
  const templateFile = new URL("../deploy/docker/nginx.conf", import.meta.url);
  const outputFile = join(directory, "nginx.conf");

  await generateNginxConfig({
    templateFile,
    exportDirectory,
    outputFile,
    apiUrl: "https://api.example.test",
  });
  const output = await readFile(outputFile, "utf8");

  assert.doesNotMatch(output, /__CONTENT_SECURITY_POLICY__|unsafe-inline|unsafe-eval/);
  assert.match(output, /add_header Content-Security-Policy/);
  assert.match(output, /frame-ancestors 'none'/);
  assert.match(output, /add_header X-Content-Type-Options "nosniff" always/);
  assert.match(output, /add_header Referrer-Policy "strict-origin-when-cross-origin" always/);
  assert.match(output, /add_header Permissions-Policy "camera=\(self\), microphone=\(\), geolocation=\(\)" always/);
  assert.match(output, /add_header X-Frame-Options "DENY" always/);
});

test("generation fails rather than weakening CSP for inline styles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "open-triage-inline-style-"));
  await writeFile(join(directory, "index.html"), "<main style='color:red'><script>bootstrap()</script></main>");

  await assert.rejects(inlineScriptHashes(directory), /contains inline styles/);
});
