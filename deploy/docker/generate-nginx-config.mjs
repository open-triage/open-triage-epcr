import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesBelow(join(directory, entry.name))
    : [join(directory, entry.name)]));
  return nested.flat();
}

export async function inlineScriptHashes(exportDirectory) {
  const hashes = new Set();
  for (const file of await filesBelow(exportDirectory)) {
    if (extname(file) !== ".html") continue;
    const html = await readFile(file, "utf8");
    if (/<style(?:\s|>)/i.test(html) || /\sstyle\s*=/i.test(html)) {
      throw new Error(`Static export contains inline styles that the CSP would block: ${file}`);
    }
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=/i.test(match[1])) continue;
      const digest = createHash("sha256").update(match[2]).digest("base64");
      hashes.add(`'sha256-${digest}'`);
    }
  }
  if (!hashes.size) throw new Error("Static export contained no inline scripts to authorize");
  return [...hashes].sort();
}

export function contentSecurityPolicy(scriptHashes, apiUrl) {
  const apiOrigin = apiUrl ? new URL(apiUrl).origin : undefined;
  return [
    "default-src 'none'",
    `script-src 'self' ${scriptHashes.join(" ")}`,
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export async function generateNginxConfig({ templateFile, exportDirectory, outputFile, apiUrl }) {
  const template = await readFile(templateFile, "utf8");
  if (!template.includes("__CONTENT_SECURITY_POLICY__")) {
    throw new Error("nginx template is missing its CSP placeholder");
  }
  const policy = contentSecurityPolicy(await inlineScriptHashes(exportDirectory), apiUrl);
  await writeFile(outputFile, template.replace("__CONTENT_SECURITY_POLICY__", policy));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [templateFile, exportDirectory, outputFile] = process.argv.slice(2);
  if (!templateFile || !exportDirectory || !outputFile) {
    throw new Error("Usage: generate-nginx-config.mjs TEMPLATE EXPORT_DIRECTORY OUTPUT");
  }
  await generateNginxConfig({
    templateFile,
    exportDirectory,
    outputFile,
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
  });
}
