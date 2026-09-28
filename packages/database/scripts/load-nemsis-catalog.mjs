import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { catalogArtifactSha256 } from "./catalog-artifact-sha256.mjs";
import { readInstallDefinitions } from "./lib/install-definitions.mjs";
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
  if (existing.rows[0] && existing.rows[0].artifact_sha256 !== catalogSha256 && existing.rows[0].provenance?.catalogSourceSha256 !== catalogSha256) {
    throw new Error(
      `${catalogStandard} ${catalog.release} is already loaded with a different checksum (${existing.rows[0].artifact_sha256})`
    );
  }
  if (existing.rows[0]) {
    await client.query("commit");
    console.log(`${catalogStandard} ${catalog.release} is already loaded with the expected checksum.`);
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

  await client.query(
    `insert into catalog.element_identity (id, namespace, canonical_key)
     select x.application_id::uuid, $2, x.element_id
     from jsonb_to_recordset($1::jsonb) as x(application_id text, element_id text)
     on conflict (namespace, canonical_key) do nothing`,
    [
      JSON.stringify(
        elementRows.map((element) => ({ application_id: element.applicationId, element_id: element.id }))
      ),
      catalogStandard,
    ]
  );

  await client.query(
    `insert into catalog.group_definition
       (release_id, group_id, parent_group_id, name, path, min_occurs, max_occurs, unbounded, repeating, definition)
     select
       $1::uuid,
       item->>'id',
       nullif(item->>'parentId', ''),
       item->>'name',
       array(select jsonb_array_elements_text(item->'path')),
       (item#>>'{occurrence,min}')::integer,
       case when item#>>'{occurrence,max}' = 'unbounded' then null else (item#>>'{occurrence,max}')::integer end,
       item#>>'{occurrence,max}' = 'unbounded',
       (item->>'repeating')::boolean,
       item
     from jsonb_array_elements($2::jsonb) item
     on conflict (release_id, group_id) do update set
       parent_group_id = excluded.parent_group_id,
       name = excluded.name,
       path = excluded.path,
       min_occurs = excluded.min_occurs,
       max_occurs = excluded.max_occurs,
       unbounded = excluded.unbounded,
       repeating = excluded.repeating,
       definition = excluded.definition`,
    [releaseId, JSON.stringify(catalog.groups)]
  );

  await client.query(
    `insert into catalog.element_definition
       (release_id, element_id, element_identity_id, section, name, description, national, state, usage,
        source_datatype, base_datatype, group_path, min_occurs, max_occurs, unbounded, nillable,
        supports_not_values, supports_pertinent_negatives, definition)
     select
       $1::uuid,
       item->>'id',
       (item->>'applicationId')::uuid,
       item->>'section',
       item->>'name',
       item->>'definition',
       (item->>'national')::boolean,
       (item->>'state')::boolean,
       item->>'usage',
       item->>'sourceDatatype',
       item#>>'{datatype,base}',
       array(select jsonb_array_elements_text(item->'groupPath')),
       (item#>>'{occurrence,min}')::integer,
       case when item#>>'{occurrence,max}' = 'unbounded' then null else (item#>>'{occurrence,max}')::integer end,
       item#>>'{occurrence,max}' = 'unbounded',
       (item->>'nillable')::boolean,
       (item#>>'{attributes,NV}')::boolean,
       (item#>>'{attributes,PN}')::boolean,
       item - 'applicationId'
     from jsonb_array_elements($2::jsonb) item
     on conflict (release_id, element_id) do update set
       element_identity_id = excluded.element_identity_id,
       section = excluded.section,
       name = excluded.name,
       description = excluded.description,
       national = excluded.national,
       state = excluded.state,
       usage = excluded.usage,
       source_datatype = excluded.source_datatype,
       base_datatype = excluded.base_datatype,
       group_path = excluded.group_path,
       min_occurs = excluded.min_occurs,
       max_occurs = excluded.max_occurs,
       unbounded = excluded.unbounded,
       nillable = excluded.nillable,
       supports_not_values = excluded.supports_not_values,
       supports_pertinent_negatives = excluded.supports_pertinent_negatives,
       definition = excluded.definition`,
    [releaseId, JSON.stringify(elementRows)]
  );

  await client.query("delete from catalog.element_option where release_id = $1", [releaseId]);
  const elementOptions = elementRows.flatMap((element) => {
    const inline =
      element.valueSource.kind === "inline-enumerated"
        ? element.valueSource.values.map((option) => ({
            elementId: element.id,
            sourceKind: "inline",
            code: option.code,
            display: option.label,
            codeSystem: ""
          }))
        : [];
    return [
      ...inline,
      ...element.permittedNotValues.map((option) => ({
        elementId: element.id,
        sourceKind: "not-value",
        code: option.code,
        display: option.label,
        codeSystem: ""
      })),
      ...element.permittedPertinentNegatives.map((option) => ({
        elementId: element.id,
        sourceKind: "pertinent-negative",
        code: option.code,
        display: option.label,
        codeSystem: ""
      }))
    ];
  });
  await client.query(
    `insert into catalog.element_option
       (release_id, element_id, source_kind, code, display, code_system)
     select $1::uuid, x.element_id, x.source_kind, x.code, x.display, x.code_system
     from jsonb_to_recordset($2::jsonb)
       as x(element_id text, source_kind text, code text, display text, code_system text)`,
    [
      releaseId,
      JSON.stringify(
        elementOptions.map((option) => ({
          element_id: option.elementId,
          source_kind: option.sourceKind,
          code: option.code,
          display: option.display,
          code_system: option.codeSystem
        }))
      )
    ]
  );

  await client.query(
    `insert into catalog.value_set
       (release_id, value_set_id, name, classification, published_at, exhaustive, definition)
     select
       $1::uuid,
       item->>'id',
       item->>'name',
       item->>'classification',
       item->>'publishedAt',
       (item->>'exhaustive')::boolean,
       item
     from jsonb_array_elements($2::jsonb) item
     on conflict (release_id, value_set_id) do update set
       name = excluded.name,
       classification = excluded.classification,
       published_at = excluded.published_at,
       exhaustive = excluded.exhaustive,
       definition = excluded.definition`,
    [releaseId, JSON.stringify(catalog.bundledLists)]
  );

  await client.query("delete from catalog.value_set_element where release_id = $1", [releaseId]);
  await client.query("delete from catalog.value_set_option where release_id = $1", [releaseId]);
  const valueSetElements = catalog.bundledLists.flatMap((valueSet) =>
    valueSet.applicableElements.map((elementId) => ({ valueSetId: valueSet.id, elementId }))
  );
  const valueSetOptions = catalog.bundledLists.flatMap((valueSet) =>
    valueSet.values.map((option) => ({
      valueSetId: valueSet.id,
      code: option.code,
      codeSystem: option.codeSystem ?? "",
      display: option.label,
      sourceDisplay: option.sourceLabel,
      category: option.category ?? null
    }))
  );
  await client.query(
    `insert into catalog.value_set_element (release_id, value_set_id, element_id)
     select $1::uuid, x.value_set_id, x.element_id
     from jsonb_to_recordset($2::jsonb) as x(value_set_id text, element_id text)`,
    [
      releaseId,
      JSON.stringify(valueSetElements.map((row) => ({ value_set_id: row.valueSetId, element_id: row.elementId })))
    ]
  );
  await client.query(
    `insert into catalog.value_set_option
       (release_id, value_set_id, code, code_system, display, source_display, category)
     select $1::uuid, x.value_set_id, x.code, x.code_system, x.display, x.source_display, x.category
     from jsonb_to_recordset($2::jsonb)
       as x(value_set_id text, code text, code_system text, display text, source_display text, category text)`,
    [
      releaseId,
      JSON.stringify(
        valueSetOptions.map((row) => ({
          value_set_id: row.valueSetId,
          code: row.code,
          code_system: row.codeSystem,
          display: row.display,
          source_display: row.sourceDisplay,
          category: row.category
        }))
      )
    ]
  );

  await client.query("delete from catalog.repeating_group_time_mapping where release_id = $1", [releaseId]);
  await client.query(
    `insert into catalog.repeating_group_time_mapping
       (release_id, group_id, resolution, time_element_id, inherited_from_group_id,
        candidate_time_element_ids, note)
     select
       $1::uuid,
       x.group_id,
       x.resolution,
       x.time_element_id,
       x.inherited_from_group_id,
       x.candidate_time_element_ids,
       x.note
     from jsonb_to_recordset($2::jsonb) as x(
       group_id text,
       resolution text,
       time_element_id text,
       inherited_from_group_id text,
       candidate_time_element_ids text[],
       note text
     )`,
    [
      releaseId,
      JSON.stringify(
        mapping.repeatingGroupTimeMappings.map((item) => ({
          group_id: item.groupId,
          resolution: item.resolution,
          time_element_id: item.timeElementId,
          inherited_from_group_id: item.inheritedFromGroupId,
          candidate_time_element_ids: item.candidateTimeElementIds,
          note: item.note
        }))
      )
    ]
  );

  await client.query("delete from catalog.analytics_element_mapping where release_id = $1", [releaseId]);
  await client.query(
    `insert into catalog.analytics_element_mapping
       (release_id, element_id, element_identity_id, analytical_location, sql_column, sql_type, identifying, mapping)
     select
       $1::uuid,
       item->>'elementId',
       (item->>'applicationId')::uuid,
       item->>'analyticalLocation',
       nullif(item->>'sqlColumn', ''),
       item->>'sqlType',
       (item->>'identifying')::boolean,
       item
     from jsonb_array_elements($2::jsonb) item`,
    [releaseId, JSON.stringify(mapping.elements)]
  );

  await client.query("update catalog.release set sealed = true where id = $1", [releaseId]);

  await client.query("commit");
  console.log(
    `Loaded ${catalogStandard} ${catalog.release}: ${catalog.groups.length} groups, ${catalog.elements.length} elements, ${elementOptions.length} element options, and ${valueSetOptions.length} bundled-list options.`
  );
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
