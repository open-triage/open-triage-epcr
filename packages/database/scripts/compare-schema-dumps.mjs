import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const environmentOnlyLine = /^(?:\\(?:un)?restrict\s+|-- Dumped (?:from database|by pg_dump) version )/;

export function normalizeSchemaDump(source) {
  return source
    .split("\n")
    .filter((line) => !environmentOnlyLine.test(line))
    .map((line) => line.replace(/[ \t]+$/u, ""))
    .join("\n")
    .trim();
}

export function compareSchemaDumps(clean, upgraded) {
  const expected = normalizeSchemaDump(clean);
  const actual = normalizeSchemaDump(upgraded);
  if (expected === actual) return;
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const length = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < length; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      throw new Error(
        `Clean and upgraded schemas differ at line ${index + 1}\n` +
        `clean: ${expectedLines[index] ?? "<missing>"}\n` +
        `upgraded: ${actualLines[index] ?? "<missing>"}`,
      );
    }
  }
}

async function main() {
  const [cleanPath, upgradedPath] = process.argv.slice(2);
  if (!cleanPath || !upgradedPath) {
    throw new Error("Usage: compare-schema-dumps.mjs CLEAN_SCHEMA UPGRADED_SCHEMA");
  }
  const [clean, upgraded] = await Promise.all([readFile(cleanPath, "utf8"), readFile(upgradedPath, "utf8")]);
  compareSchemaDumps(clean, upgraded);
  console.log(JSON.stringify({ event: "upgrade_schema_equivalence_verified" }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
