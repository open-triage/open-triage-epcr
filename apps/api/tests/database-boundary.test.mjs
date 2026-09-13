import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  affectedRowCount,
  databaseInteger,
  databaseNumber,
  mutationRows
} from "../dist/database/mutation-result.js";

test("mutation results normalize both TypeORM PostgreSQL and CTE row shapes", () => {
  const rows = [{ id: "one" }, { id: "two" }];
  assert.equal(mutationRows([rows, 2]), rows);
  assert.equal(mutationRows(rows), rows);
  assert.deepEqual(mutationRows(undefined), []);
  assert.equal(affectedRowCount([rows, 2]), 2);
  assert.equal(affectedRowCount(rows), 2);
  assert.equal(affectedRowCount(undefined), 0);
});

test("database scalar codecs accept PostgreSQL strings and reject lossy values", () => {
  assert.equal(databaseInteger("42", "test integer"), 42);
  assert.equal(databaseNumber("98.6", "test numeric"), 98.6);
  assert.throws(() => databaseInteger("1.5", "test integer"), /safe database integer/);
  assert.throws(() => databaseInteger("9007199254740992", "test integer"), /safe database integer/);
  assert.throws(() => databaseNumber("not-a-number", "test numeric"), /finite database number/);
});

test("direct mutations with RETURNING are normalized at every source boundary", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceDirectory = path.resolve(testDirectory, "../src");
  const files = (await readdir(sourceDirectory, { recursive: true }))
    .filter((name) => name.endsWith(".ts"));
  const violations = [];
  const query = /\.query(?:<[\s\S]*?>)?\s*\(\s*`([\s\S]*?)`/g;
  for (const name of files) {
    const source = await readFile(path.join(sourceDirectory, name), "utf8");
    for (const match of source.matchAll(query)) {
      const sql = match[1].trim();
      if (!/^(insert|update|delete)\b/i.test(sql) || !/\breturning\b/i.test(sql)) continue;
      const declarationStart = source.lastIndexOf("const ", match.index);
      const declaration = source.slice(Math.max(0, declarationStart), match.index);
      if (!declaration.includes("mutationRows")) {
        violations.push(`${name}: ${sql.split(/\s+/).slice(0, 3).join(" ")}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
