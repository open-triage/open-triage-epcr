import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, link, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ConflictException, UnprocessableEntityException } from "@nestjs/common";

export type DefinitionKind = "catalog" | "form" | "validation";
export interface CanonicalPackage {
  format: "opentriage-definition";
  schemaVersion: 1;
  kind: DefinitionKind;
  name: string;
  version: string;
  catalog: { sha256: string };
  definition: unknown;
  sha256: string;
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => [key, ordered(item)]));
}
export function contentDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}
export function catalogFingerprint(definition: Record<string, unknown>): string {
  const { sourceReleaseId: _localId, ...content } = definition;
  return contentDigest(content);
}
export function makePackage(input: Omit<CanonicalPackage, "format" | "schemaVersion" | "sha256">): CanonicalPackage {
  const content = { format: "opentriage-definition" as const, schemaVersion: 1 as const, ...input };
  return { ...content, sha256: contentDigest(content) };
}
export function parsePackage(value: unknown, kind: DefinitionKind, options: { ignoreVersion?: boolean } = {}): CanonicalPackage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new UnprocessableEntityException("Expected canonical JSON object");
  const p = value as CanonicalPackage;
  const { sha256, ...content } = p;
  if (p.format !== "opentriage-definition" || p.schemaVersion !== 1 || p.kind !== kind ||
      typeof p.name !== "string" || !p.name.trim() || p.name.length > 120 || (!options.ignoreVersion && typeof p.version !== "string") ||
      !p.catalog || !/^[a-f0-9]{64}$/.test(p.catalog.sha256) || !p.definition || contentDigest(content) !== sha256) {
    throw new UnprocessableEntityException("Unsupported canonical format/version, kind, or content digest");
  }
  return p;
}
export function localDefinitionsRoot(): string {
  if (process.env.OPENTRIAGE_DEFINITIONS_ROOT) return path.resolve(process.env.OPENTRIAGE_DEFINITIONS_ROOT);
  let root = process.cwd();
  while (!existsSync(path.join(root, "defines"))) {
    const parent = path.dirname(root);
    if (parent === root) throw new Error("Set OPENTRIAGE_DEFINITIONS_ROOT to a persistent writable directory");
    root = parent;
  }
  return path.join(root, "defines");
}
function filenamePart(value: string, fallback: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "") || fallback;
}
export async function writePackage(p: CanonicalPackage): Promise<void> {
  const directory = path.join(localDefinitionsRoot(), p.kind === "form" ? "forms" : p.kind, "local");
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${filenamePart(p.name, p.kind)}-v${filenamePart(p.version, "unknown")}.json`);
  const temporary = path.join(directory, `.${p.sha256}-${randomUUID()}.tmp`);
  const text = JSON.stringify(ordered(p), null, 2) + "\n";
  await writeFile(temporary, text, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (contentDigest(JSON.parse(await readFile(destination, "utf8"))) !== contentDigest(p))
      throw new ConflictException("A different canonical file already uses this name and version");
  } finally { await unlink(temporary); }
}
export async function discoverPackages(kind: DefinitionKind): Promise<Array<{ file: string; package?: CanonicalPackage; raw?: Record<string, unknown>; error?: string }>> {
  const root = localDefinitionsRoot();
  const folder = kind === "form" ? "forms" : kind;
  const directories = [path.join(root, folder), path.join(root, folder, "local")];
  const results = await Promise.all(directories.map(async (directory) => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    return Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).sort((a,b) => a.name.localeCompare(b.name)).map(async (entry) => {
      try {
        const raw = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
        const file = path.relative(root, path.join(directory, entry.name));
        return raw.format === "opentriage-definition" ? { file, package: parsePackage(raw, kind, { ignoreVersion: true }) } : { file, raw };
      }
      catch { return { file: path.relative(root, path.join(directory, entry.name)), error: "Invalid or unsupported canonical JSON" }; }
    }));
  }));
  return results.flat();
}
