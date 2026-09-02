import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const catalogPath = path.join(repoRoot, "apps/web/app/data/nemsis-data-model-3.5.1.json");
const migrationPath = path.join(repoRoot, "supabase/migrations/202608300001_initial.sql");
const identifyingPath = path.join(packageRoot, "config/identifying-elements.json");
const groupTimesPath = path.join(packageRoot, "config/repeating-group-times.json");
const outputPath = path.join(packageRoot, "generated/nemsis-3.5.1-analytics-mapping.json");
const checkOnly = process.argv.includes("--check");

const WIDE_START = "  -- BEGIN GENERATED NEMSIS WIDE COLUMNS";
const WIDE_END = "  -- END GENERATED NEMSIS WIDE COLUMNS";
const VIEW_START = "  -- BEGIN GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS";
const VIEW_END = "  -- END GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS";
const APPLICATION_NAMESPACE = "61c2071c-f6f0-4df5-82aa-f8461ad95dd6";

const [catalogText, migration, identifyingText, groupTimesText] = await Promise.all([
  readFile(catalogPath, "utf8"),
  readFile(migrationPath, "utf8"),
  readFile(identifyingPath, "utf8"),
  readFile(groupTimesPath, "utf8")
]);

const catalog = JSON.parse(catalogText);
const identifyingConfig = JSON.parse(identifyingText);
const groupTimeConfig = JSON.parse(groupTimesText);
const identifying = new Set(identifyingConfig.elements);
const groups = new Map(catalog.groups.map((group) => [group.id, group]));
const patientCareElements = catalog.elements.filter((element) =>
  element.groupPath.includes("PatientCareReportGroup")
);
const knownPatientCareIds = new Set(patientCareElements.map((element) => element.id));

for (const elementId of identifying) {
  if (!knownPatientCareIds.has(elementId)) {
    throw new Error(`Identifying-element configuration references unknown PatientCareReport element ${elementId}`);
  }
}

function repeatsWithinPatientCareReport(element) {
  const reportIndex = element.groupPath.indexOf("PatientCareReportGroup");
  return (
    element.occurrence.max === "unbounded" ||
    Number(element.occurrence.max) > 1 ||
    element.groupPath.slice(reportIndex + 1).some((groupId) => groups.get(groupId)?.repeating)
  );
}

function sqlColumn(elementId) {
  return elementId.replace(".", "_").toLowerCase();
}

function sqlShape(element) {
  if (element.valueSource.kind !== "scalar") {
    return {
      sqlType: "text",
      columns: [
        { name: sqlColumn(element.id), type: "text", role: "code" },
        { name: `${sqlColumn(element.id)}_display`, type: "text", role: "display" },
        { name: `${sqlColumn(element.id)}_system`, type: "text", role: "code-system" },
        { name: `${sqlColumn(element.id)}_terminology_version`, type: "text", role: "terminology-version" }
      ]
    };
  }

  const baseTypes = {
    string: "text",
    integer: "bigint",
    decimal: "numeric",
    boolean: "boolean",
    date: "date",
    dateTime: "timestamptz",
    time: "time",
    duration: "interval",
    binary: "bytea",
    anyURI: "text"
  };
  const type = baseTypes[element.datatype.base];
  if (!type) throw new Error(`Unsupported analytical datatype ${element.datatype.base} for ${element.id}`);

  const columns = [{ name: sqlColumn(element.id), type, role: "value" }];
  if (["integer", "decimal", "duration"].includes(element.datatype.base)) {
    columns.push({ name: `${sqlColumn(element.id)}_lexical`, type: "text", role: "entered-lexical-value" });
  }
  if (["date", "dateTime", "time"].includes(element.datatype.base)) {
    columns.push({ name: `${sqlColumn(element.id)}_precision`, type: "text", role: "recorded-precision" });
  }
  if (["dateTime", "time"].includes(element.datatype.base)) {
    columns.push({ name: `${sqlColumn(element.id)}_utc_offset_minutes`, type: "smallint", role: "recorded-utc-offset" });
  }
  return { sqlType: type, columns };
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

const mappings = patientCareElements.map((element) => {
  const repeatable = repeatsWithinPatientCareReport(element);
  const shape = sqlShape(element);
  return {
    elementId: element.id,
    applicationId: uuidV5(APPLICATION_NAMESPACE, `NEMSIS:${element.id}`),
    name: element.name,
    groupPath: element.groupPath,
    usage: element.usage,
    national: element.national,
    state: element.state,
    baseDatatype: element.datatype.base,
    sourceDatatype: element.sourceDatatype,
    analyticalLocation: repeatable ? "repeatable" : "wide",
    sqlColumn: repeatable ? null : sqlColumn(element.id),
    sqlType: shape.sqlType,
    columns: repeatable ? [] : shape.columns,
    identifying: identifying.has(element.id)
  };
});

const repeatingGroups = new Map();
for (const element of patientCareElements) {
  const reportIndex = element.groupPath.indexOf("PatientCareReportGroup");
  for (const groupId of element.groupPath.slice(reportIndex + 1)) {
    if (groups.get(groupId)?.repeating) repeatingGroups.set(groupId, groups.get(groupId));
  }
}

const timeMappings = [...repeatingGroups.values()].map((group) => {
  const localDateTimes = patientCareElements.filter((element) => {
    if (element.datatype.base !== "dateTime") return false;
    const repeatingAncestors = element.groupPath.filter((groupId) => repeatingGroups.has(groupId));
    return repeatingAncestors.at(-1) === group.id;
  });
  const configured = groupTimeConfig.mappings[group.id];
  if (!configured) throw new Error(`Repeating group ${group.id} needs an explicit time mapping`);
  if (configured.resolution === "element" && !localDateTimes.some((item) => item.id === configured.timeElementId)) {
    throw new Error(`${group.id} maps to ${configured.timeElementId}, which is not its single local dateTime element`);
  }
  if (configured.resolution === "element" && localDateTimes.length !== 1) {
    throw new Error(`${group.id} must have exactly one local dateTime candidate; found ${localDateTimes.length}`);
  }
  if (configured.resolution === "inherited") {
    if (!group.path.includes(configured.inheritedFromGroupId)) {
      throw new Error(`${group.id} cannot inherit time from non-ancestor ${configured.inheritedFromGroupId}`);
    }
    if (!knownPatientCareIds.has(configured.timeElementId)) {
      throw new Error(`${group.id} inherits unknown time element ${configured.timeElementId}`);
    }
  }
  if (configured.resolution === "non-temporal" && (configured.timeElementId || configured.inheritedFromGroupId)) {
    throw new Error(`${group.id} is non-temporal but declares a time source`);
  }
  return {
    groupId: group.id,
    groupPath: group.path,
    resolution: configured.resolution,
    timeElementId: configured.timeElementId ?? null,
    inheritedFromGroupId: configured.inheritedFromGroupId ?? null,
    candidateTimeElementIds: localDateTimes.map((item) => item.id),
    candidateCount: localDateTimes.length,
    flaggedCandidateMismatch: localDateTimes.length !== 1,
    note: configured.note
  };
});

for (const configuredGroup of Object.keys(groupTimeConfig.mappings)) {
  if (!repeatingGroups.has(configuredGroup)) {
    throw new Error(`Time mapping references unknown or non-repeating PatientCareReport group ${configuredGroup}`);
  }
}

const wideMappings = mappings.filter((mapping) => mapping.analyticalLocation === "wide");
const repeatMappings = mappings.filter((mapping) => mapping.analyticalLocation === "repeatable");
if (mappings.length !== 441 || wideMappings.length !== 198 || repeatMappings.length !== 243) {
  throw new Error(
    `Unexpected NEMSIS projection split: ${mappings.length} total, ${wideMappings.length} wide, ${repeatMappings.length} repeatable`
  );
}

const artifact = {
  schemaVersion: "1.0.0",
  standard: "NEMSIS",
  catalogVersion: catalog.release,
  dataset: catalog.dataset,
  catalogArtifactSha256: createHash("sha256").update(catalogText).digest("hex"),
  applicationIdentityNamespace: APPLICATION_NAMESPACE,
  naming: "Lowercase NEMSIS element identifier with the dot replaced by an underscore; companion columns use descriptive suffixes.",
  counts: {
    patientCareReportElements: mappings.length,
    wideElements: wideMappings.length,
    repeatableElements: repeatMappings.length,
    identifyingElements: mappings.filter((mapping) => mapping.identifying).length,
    repeatingGroups: timeMappings.length,
    repeatingGroupsWithOneLocalTimeCandidate: timeMappings.filter((mapping) => mapping.candidateCount === 1).length,
    repeatingGroupsFlaggedForZeroOrMultipleCandidates: timeMappings.filter((mapping) => mapping.flaggedCandidateMismatch).length
  },
  repeatingGroupTimeMappings: timeMappings,
  elements: mappings
};
const output = `${JSON.stringify(artifact, null, 2)}\n`;

const generatedColumnLines = wideMappings.flatMap((mapping) =>
  mapping.columns.map((column) => `  ${column.name} ${column.type},`)
);
const wideBlock = [WIDE_START, ...generatedColumnLines, WIDE_END].join("\n");

const baseViewColumns = [
  "reporting_date",
  "reporting_date_source",
  "report_id",
  "incident_id",
  "organization_id",
  "agency_demographic_version_id",
  "patient_key",
  "patient_key_version",
  "form_version_id",
  "form_version",
  "catalog_release_id",
  "catalog_version",
  "signed_snapshot_id",
  "signed_snapshot_sha256",
  "signed_at",
  "last_amended_at",
  "amendment_count",
  "effective_amendment_sequence",
  "projector_version",
  "projected_at",
  "element_statuses",
  "additional_elements",
  "quality_flags",
  "quality_rule_version"
];
const pseudonymousColumns = [
  ...baseViewColumns,
  ...wideMappings.filter((mapping) => !mapping.identifying).flatMap((mapping) => mapping.columns.map((column) => column.name))
];
const viewLines = pseudonymousColumns.map(
  (column, index) => `  ${column}${index === pseudonymousColumns.length - 1 ? "" : ","}`
);
const viewBlock = [VIEW_START, ...viewLines, VIEW_END].join("\n");

function replaceGeneratedBlock(source, start, end, replacement) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Could not find generated block ${start}`);
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex + end.length)}`;
}

let generatedMigration = replaceGeneratedBlock(migration, WIDE_START, WIDE_END, wideBlock);
generatedMigration = replaceGeneratedBlock(generatedMigration, VIEW_START, VIEW_END, viewBlock);

if (checkOnly) {
  const committedOutput = await readFile(outputPath, "utf8").catch(() => "");
  if (committedOutput !== output || generatedMigration !== migration) {
    console.error("NEMSIS database artifacts are stale. Run: npm run generate -w @open-triage/database");
    process.exitCode = 1;
  }
} else {
  await writeFile(outputPath, output);
  await writeFile(migrationPath, generatedMigration);
  console.log(
    `Generated ${wideMappings.length} wide and ${repeatMappings.length} repeatable NEMSIS mappings; ${timeMappings.filter((mapping) => mapping.flaggedCandidateMismatch).length} repeating groups have zero or multiple local time candidates.`
  );
}
