import ts from 'typescript';
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

function unnormalizedMutationResults(source, filename) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const violations = [];
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "query") {
      const argument = node.arguments[0];
      if (argument && (ts.isNoSubstitutionTemplateLiteral(argument) || ts.isTemplateExpression(argument) || ts.isStringLiteral(argument))) {
        const sql = argument.getText(file).slice(1, -1).trim();
        if (/^(insert|update|delete)\b/i.test(sql) && /\breturning\b/i.test(sql)) {
          let result = node;
          while (result.parent && (ts.isAwaitExpression(result.parent) || ts.isParenthesizedExpression(result.parent)
            || ts.isAsExpression(result.parent) || ts.isNonNullExpression(result.parent))) result = result.parent;
          const consumer = result.parent;
          // A discarded result has no row-shape boundary to normalize.
          if (!ts.isExpressionStatement(consumer) && !(ts.isCallExpression(consumer)
            && ts.isIdentifier(consumer.expression) && consumer.expression.text === "mutationRows")) {
            violations.push(`${filename}: ${sql.split(/\s+/).slice(0, 3).join(" ")}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

test("mutation boundary inspection checks each conditional branch and quoted SQL", () => {
  const source = "const rows = id ? mutationRows(await db.query(`update units set name=$1 returning id`)) : await db.query('insert into units values ($1) returning id');";
  assert.deepEqual(unnormalizedMutationResults(source, "fixture.ts"), ["fixture.ts: insert into units"]);
  assert.deepEqual(unnormalizedMutationResults("const rows = mutationRows(await db.query('insert into units values ($1) returning id'));", "fixture.ts"), []);
  assert.deepEqual(unnormalizedMutationResults("await db.query('delete from units returning id');", "fixture.ts"), []);
});

test("direct mutations with RETURNING are normalized at every source boundary", async () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceDirectory = path.resolve(testDirectory, "../src");
  const files = (await readdir(sourceDirectory, { recursive: true })).filter(name => name.endsWith(".ts"));
  const violations = [];
  for (const name of files) violations.push(...unnormalizedMutationResults(await readFile(path.join(sourceDirectory, name), "utf8"), name));
  assert.deepEqual(violations, []);
});
