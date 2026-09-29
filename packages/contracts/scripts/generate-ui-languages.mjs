import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const messageDirectory = path.join(root, "apps/web/messages");
const contractOutput = path.join(root, "packages/contracts/src/ui-languages.generated.ts");
const webOutput = path.join(root, "apps/web/app/message-dictionaries.generated.ts");
const languageCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function validMessage(value) {
  return typeof value === "string" ||
    (value !== null && typeof value === "object" && !Array.isArray(value) &&
      typeof value.other === "string" &&
      (value.one === undefined || typeof value.one === "string") &&
      Object.keys(value).every((key) => key === "one" || key === "other"));
}

export async function discoverUiLanguages(directory = messageDirectory) {
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json") &&
    file.slice(0, -5).length <= 35 && languageCode.test(file.slice(0, -5))).sort();
  const languages = files.map((file) => file.slice(0, -5));
  if (!languages.includes("en")) throw new Error("apps/web/messages/en.json is required for fallback");
  for (const [index, code] of languages.entries()) {
    const dictionary = JSON.parse(await readFile(path.join(directory, files[index]), "utf8"));
    if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary) ||
        Object.entries(dictionary).some(([key, value]) => !key || !validMessage(value))) {
      throw new Error(`Invalid message dictionary: ${files[index]}`);
    }
  }
  return languages;
}

function generatedFiles(languages) {
  const codes = JSON.stringify(languages);
  const contracts = `// Generated from apps/web/messages/*.json. Run npm run build -w @open-triage/contracts.\n` +
    `export const SUPPORTED_UI_LANGUAGES: readonly string[] = ${codes};\n` +
    `export function isSupportedUiLanguage(value: unknown): value is string {\n` +
    `  return typeof value === "string" && SUPPORTED_UI_LANGUAGES.includes(value);\n}\n`;
  const imports = languages.map((code, index) => `import dictionary${index} from "../messages/${code}.json";`).join("\n");
  const entries = languages.map((code, index) => `  ${JSON.stringify(code)}: dictionary${index},`).join("\n");
  const web = `// Generated from apps/web/messages/*.json. Run npm run build -w @open-triage/contracts.\n` +
    `${imports}\n\nexport const MESSAGE_DICTIONARIES = {\n${entries}\n};\n`;
  return [[contractOutput, contracts], [webOutput, web]];
}

export async function generateUiLanguages({ directory = messageDirectory, outputs = [contractOutput, webOutput], check = false } = {}) {
  const languages = await discoverUiLanguages(directory);
  for (const [index, [, content]] of generatedFiles(languages).entries()) {
    const file = outputs[index];
    if (check) {
      const current = await readFile(file, "utf8").catch(() => "");
      if (current !== content) throw new Error(`${path.relative(root, file)} is stale; regenerate UI languages`);
    } else {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  }
  return languages;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const languages = await generateUiLanguages({ check: process.argv.includes("--check") });
  console.log(`UI languages: ${languages.join(", ")}`);
}
