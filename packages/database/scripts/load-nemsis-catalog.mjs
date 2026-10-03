import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { catalogArtifactSha256 } from "./catalog-artifact-sha256.mjs";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";
import { materializeBaseCatalog } from "./lib/base-catalog.mjs";
import { readCatalogLocalizationSeed } from "./lib/catalog-localization.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const definitions = await readInstallDefinitions(path.join(repoRoot, "defines"));
const selectedCatalog = definitions.defaultPair.catalog;
const catalogPath = path.join(repoRoot, "defines/catalog", selectedCatalog.file);
const mappingPath = path.join(packageRoot, `generated/${selectedCatalog.key}-analytics-mapping.json`);
const localizationPath = path.join(repoRoot, "defines/localization/localization_sv.json");
const catalogStandard = selectedCatalog.standard;
const databaseUrl = process.env.DATABASE_URL;
// The pre-starter-list 3.5.1 release is sealed in existing installations.
// Preserve it during upgrades; the expanded artifact is used for fresh installs.
const previousCatalogSourceSha256 = "5d7f4364f8340e16f129c6ea31ea225ee5caa998ea8a26b7a5075e24cb9401c2";
const previousReleaseSha256 = "a4e71a69a5011e785e553bacbe38e0e8a629e9fc76895ce759f52e20bb14654c";

if (!databaseUrl) throw new Error("DATABASE_URL is required to load the NEMSIS catalog");

const [catalogText, mappingText] = await Promise.all([
  readFile(catalogPath, "utf8"),
  readFile(mappingPath, "utf8")
]);
const catalog = JSON.parse(catalogText);
const mapping = JSON.parse(mappingText);
const { elementLocalization, groupLocalization, codeListLocalization, specialChoiceLocalization,
  coverage, seedSha256 } = await readCatalogLocalizationSeed(localizationPath, catalog);
const missing = Object.entries(coverage.missing).flatMap(([kind, ids]) => ids.map((id) => `${kind}:${id}`));
if (missing.length) throw new Error(`Swedish catalog seed is incomplete: ${missing.join(", ")}`);
console.log(`Swedish catalog coverage: ${JSON.stringify(coverage.supplied)}; ${coverage.reviewPending.length} candidates require clinical review.`);
const catalogSha256 = catalogArtifactSha256(catalogText);
const releaseSha256 = createHash("sha256").update(`${catalogSha256}:${seedSha256}`).digest("hex");

if (mapping.catalogArtifactSha256 !== catalogSha256 || mapping.catalogVersion !== catalog.release) {
  throw new Error("Generated database mapping does not match the committed NEMSIS catalog");
}

function uuidToBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function uuidV5(namespace, name) {
  const digest = createHash("sha1").update(uuidToBytes(namespace)).update(name).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const mappedByElement = new Map(mapping.elements.map((item) => [item.elementId, item]));
const elementRows = catalog.elements.map((element) => ({
  ...element,
  applicationId:
    mappedByElement.get(element.id)?.applicationId ??
    uuidV5(mapping.applicationIdentityNamespace, `NEMSIS:${element.id}`)
}));

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("begin");
  await client.query("set constraints all deferred");

  const existing = await client.query(
    "select id, artifact_sha256, provenance from catalog.release where standard = $1 and version = $2 and dataset = $3 for update",
    [catalogStandard, catalog.release, catalog.dataset]
  );
  const installed = existing.rows[0];
  const installedSourceSha256 = installed?.provenance?.catalogSourceSha256;
  const recognizedPreviousRelease = installed && catalogStandard === "NEMSIS" && catalog.release === "3.5.1" &&
    (installedSourceSha256 === previousCatalogSourceSha256 || installed.artifact_sha256 === previousReleaseSha256);
  if (installed && installed.artifact_sha256 !== catalogSha256 && installedSourceSha256 !== catalogSha256 &&
      !recognizedPreviousRelease) {
    throw new Error(
      `${catalogStandard} ${catalog.release} is already loaded with a different checksum (${installed.artifact_sha256})`
    );
  }
  if (installed) {
    await client.query("commit");
    console.log(recognizedPreviousRelease
      ? `${catalogStandard} ${catalog.release} is sealed with the previous starter lists; preserving its published contents.`
      : `${catalogStandard} ${catalog.release} is already loaded with the expected checksum.`);
    await client.end();
    process.exit(0);
  }

  const releaseResult = await client.query(
    `insert into catalog.release
       (standard, version, dataset, artifact_schema_version, artifact_sha256, provenance, sealed)
     values ($1, $2, $3, $4, $5, $6::jsonb, false)
     on conflict (standard, version, dataset) do update
       set artifact_sha256 = excluded.artifact_sha256,
           provenance = excluded.provenance
     returning id`,
    [catalogStandard, catalog.release, catalog.dataset, catalog.schemaVersion, releaseSha256, JSON.stringify({ ...catalog.provenance, catalogSourceSha256: catalogSha256, elementLocalization, groupLocalization, codeListLocalization, specialChoiceLocalization, localizationSeedSha256: seedSha256 })]
  );
  const releaseId = releaseResult.rows[0].id;

  const { elementOptionCount, valueSetOptionCount } = await materializeBaseCatalog(client,
    { releaseId, catalog, elementRows, mapping, catalogStandard });

  await client.query("commit");
  console.log(
    `Loaded ${catalogStandard} ${catalog.release}: ${catalog.groups.length} groups, ${catalog.elements.length} elements, ${elementOptionCount} element options, and ${valueSetOptionCount} bundled-list options.`
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
