import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverUiLanguages, generateUiLanguages } from "./generate-ui-languages.mjs";

test("a new message JSON is discovered and included in both build manifests", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ui-languages-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "en.json"), JSON.stringify({ "hello": "Hello" }));
  await writeFile(path.join(directory, "fr.json"), JSON.stringify({ "hello": "Bonjour" }));
  const outputs = [path.join(directory, "contracts.ts"), path.join(directory, "web.ts")];
  assert.deepEqual(await generateUiLanguages({ directory, outputs }), ["en", "fr"]);
  assert.match(await readFile(outputs[0], "utf8"), /\["en","fr"\]/);
  assert.match(await readFile(outputs[1], "utf8"), /messages\/fr\.json/);
  await generateUiLanguages({ directory, outputs, check: true });
  await writeFile(path.join(directory, "fr.json"), JSON.stringify({ "hello": "Salut" }));
  await writeFile(outputs[0], "stale");
  await assert.rejects(generateUiLanguages({ directory, outputs, check: true }), /stale/);
});

test("language discovery requires English fallback and valid dictionaries", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ui-languages-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "fr.json"), "{}");
  await assert.rejects(discoverUiLanguages(directory), /en.json is required/);
  await writeFile(path.join(directory, "en.json"), "{}");
  await writeFile(path.join(directory, "fr.json"), JSON.stringify({ "bad": 3 }));
  await assert.rejects(discoverUiLanguages(directory), /Invalid message dictionary/);
  await rm(path.join(directory, "fr.json"));
  await writeFile(path.join(directory, "bad name.json"), "{}");
  assert.deepEqual(await discoverUiLanguages(directory), ["en"]);
});
