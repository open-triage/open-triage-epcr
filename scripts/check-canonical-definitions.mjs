import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", ".next", "coverage", "dist", "node_modules"]);
const sourceExtension = /\.(?:cjs|js|mjs|sh|ts|tsx)$/;
const mutation = String.raw`(?:appendFile|appendFileSync|copyFile|copyFileSync|createWriteStream|rename|renameSync|rm|rmSync|truncate|truncateSync|unlink|unlinkSync|writeFile|writeFileSync)`;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.flatMap((entry) => {
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : [sourceFiles(path.join(directory, entry.name))];
    return sourceExtension.test(entry.name) && !entry.name.includes(".test.") ? [[path.join(directory, entry.name)]] : [];
  }))).flat();
}

export function canonicalDefinitionWriteViolations(source, filename = "source") {
  const canonicalVariables = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*(?:["'`]defines(?:[\\/]|["'`])|definitionsRoot)[^;\n]*/g)]
    .map((match) => match[1]);
  const violations = [];
  if (new RegExp(String.raw`\b${mutation}\s*\(\s*[^,\n]*(?:["'\`]defines[\\/])`).test(source)) {
    violations.push(`${filename}: directly mutates a path under defines`);
  }
  for (const variable of canonicalVariables) {
    if (new RegExp(String.raw`\b${mutation}\s*\(\s*${variable}\b`).test(source)) {
      violations.push(`${filename}: mutates canonical defines path through ${variable}`);
    }
  }
  return violations;
}

export async function checkCanonicalDefinitions() {
  const violations = [];
  for (const filename of await sourceFiles(repository)) {
    const relative = path.relative(repository, filename).replaceAll(path.sep, "/");
    const source = await readFile(filename, "utf8");
    violations.push(...canonicalDefinitionWriteViolations(source, relative));
  }
  if (violations.length) throw new Error(`Canonical definitions must be read-only inputs:\n${violations.join("\n")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkCanonicalDefinitions().then(() => console.log("Canonical JSON files under defines are read-only inputs."))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
