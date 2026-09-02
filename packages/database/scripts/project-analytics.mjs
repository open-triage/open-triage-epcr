import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const PROJECTOR_VERSION = "1.0.0";
const BATCH_SIZE = Number.parseInt(process.env.ANALYTICS_PROJECTOR_BATCH_SIZE ?? "100", 10);

if (!databaseUrl) throw new Error("DATABASE_URL is required to project analytics");
if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 1000) {
  throw new Error("ANALYTICS_PROJECTOR_BATCH_SIZE must be an integer from 1 through 1000");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

function sparseObject(value) {
  return Object.keys(value).length === 0 ? null : value;
}

function valuePayload(row) {
  return {
    kind: row.value_kind,
    valueText: row.value_text,
    valueInteger: row.value_integer,
    valueNumeric: row.value_numeric,
    valueBoolean: row.value_boolean,
    valueDate: row.value_date,
    valueDateTime: row.value_datetime,
    valueTime: row.value_time,
    valueDuration: row.value_duration,
    valueLexical: row.value_lexical,
    valueUtcOffsetMinutes: row.value_utc_offset_minutes,
    valuePrecision: row.value_precision,
    code: row.code,
    codeSystem: row.code_system,
    display: row.code_display,
    terminologyVersion: row.terminology_version,
    absenceCode: row.absence_code,
    absenceDisplay: row.absence_display
  };
}

function amendedRow(base, corrected) {
  const aliases = {
    id: "id",
    elementOccurrenceId: "id",
    reportId: "report_id",
    catalogReleaseId: "catalog_release_id",
    groupInstanceId: "group_instance_id",
    elementIdentityId: "element_identity_id",
    elementId: "element_id",
    ordinal: "ordinal",
    analyticalRepeatable: "analytical_repeatable",
    identifying: "identifying",
    valueKind: "value_kind",
    valueText: "value_text",
    valueInteger: "value_integer",
    valueNumeric: "value_numeric",
    valueBoolean: "value_boolean",
    valueDate: "value_date",
    valueDateTime: "value_datetime",
    valueTime: "value_time",
    valueDuration: "value_duration",
    valueLexical: "value_lexical",
    valueUtcOffsetMinutes: "value_utc_offset_minutes",
    valuePrecision: "value_precision",
    code: "code",
    codeSystem: "code_system",
    codeDisplay: "code_display",
    terminologyVersion: "terminology_version",
    absenceCode: "absence_code",
    absenceDisplay: "absence_display",
    sourceAttributes: "source_attributes",
    correlationId: "correlation_id",
    documentedTime: "documented_time",
    documentedUtcOffsetMinutes: "documented_utc_offset_minutes",
    documentedPrecision: "documented_precision",
    serverReceivedTime: "server_received_time"
  };
  const result = { ...base };
  for (const [key, value] of Object.entries(corrected)) {
    result[aliases[key] ?? key] = value;
  }
  return result;
}

function instancePath(groupById, groupInstanceId) {
  const path = [];
  const seen = new Set();
  let current = groupById.get(groupInstanceId);
  while (current) {
    if (seen.has(current.id)) throw new Error(`Cycle in group instance ancestry at ${current.id}`);
    seen.add(current.id);
    path.unshift(current.id);
    current = current.parent_group_instance_id ? groupById.get(current.parent_group_instance_id) : null;
  }
  return path;
}

function ancestorInstance(groupById, groupInstanceId, wantedGroupId) {
  let current = groupById.get(groupInstanceId);
  while (current) {
    if (current.group_id === wantedGroupId) return current;
    current = current.parent_group_instance_id ? groupById.get(current.parent_group_instance_id) : null;
  }
  return null;
}

function sourceValue(row, baseDatatype) {
  if (row.value_kind === "coded") return row.code;
  const valueColumns = {
    string: "value_text",
    integer: "value_integer",
    decimal: "value_numeric",
    boolean: "value_boolean",
    date: "value_date",
    dateTime: "value_datetime",
    time: "value_time",
    duration: "value_duration",
    binary: "value_binary",
    anyURI: "value_text"
  };
  return row[valueColumns[baseDatatype]];
}

function wideValues(row, mapping) {
  if (["null", "pertinent-negative", "absent"].includes(row.value_kind)) return {};
  const result = {};
  for (const column of mapping.columns) {
    if (column.role === "value" || column.role === "code") result[column.name] = sourceValue(row, mapping.baseDatatype);
    if (column.role === "display") result[column.name] = row.code_display;
    if (column.role === "code-system") result[column.name] = row.code_system;
    if (column.role === "terminology-version") result[column.name] = row.terminology_version;
    if (column.role === "entered-lexical-value") result[column.name] = row.value_lexical;
    if (column.role === "recorded-precision") result[column.name] = row.value_precision;
    if (column.role === "recorded-utc-offset") result[column.name] = row.value_utc_offset_minutes;
  }
  return result;
}

async function insertOne(table, row) {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => column);
  const values = entries.map(([, value]) => value);
  const parameters = values.map((_, index) => `$${index + 1}`);
  await client.query(
    `insert into ${table} (${columns.join(", ")}) values (${parameters.join(", ")})`,
    values
  );
}

async function insertMany(table, rows) {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const chunkSize = Math.max(1, Math.floor(60000 / columns.length));
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const values = [];
    const tuples = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        values.push(row[column] ?? null);
        return `$${values.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`,
      values
    );
  }
}

async function projectReport(reportId) {
  const reportResult = await client.query(
    `select
       r.id as report_id,
       r.reporting_date,
       r.reporting_date_source,
       r.incident_id,
       r.organization_id,
       r.agency_demographic_version_id,
       r.catalog_release_id,
       p.pseudonymous_key as patient_key,
       p.pseudonymous_key_version as patient_key_version,
       fv.id as form_version_id,
       fv.version as form_version,
       cr.version as catalog_version,
       ss.id as signed_snapshot_id,
       ss.canonical_sha256 as signed_snapshot_sha256,
       ss.signed_at,
       coalesce(max(a.sequence), 0)::integer as amendment_count,
       max(a.signed_at) as last_amended_at
     from clinical.report r
     join clinical.patient p on p.id = r.patient_id
     join forms.form_version fv on fv.id = r.form_version_id
     join catalog.release cr on cr.id = r.catalog_release_id
     join clinical.signed_snapshot ss on ss.report_id = r.id
     left join clinical.amendment a on a.report_id = r.id
     where r.id = $1 and r.status = 'signed'
     group by r.id, p.pseudonymous_key, p.pseudonymous_key_version, fv.id, cr.version, ss.id`,
    [reportId]
  );
  if (reportResult.rowCount === 0) throw new Error(`Signed report ${reportId} was not found`);
  const report = reportResult.rows[0];

  const [elementResult, groupResult, mappingResult, timeResult, amendmentResult] = await Promise.all([
    client.query(
      `select * from clinical.element_occurrence
       where report_id = $1 and tombstoned_at is null
       order by group_instance_id nulls first, element_id, ordinal`,
      [reportId]
    ),
    client.query(
      `select * from clinical.group_instance
       where report_id = $1 and tombstoned_at is null`,
      [reportId]
    ),
    client.query(
      `select mapping from catalog.analytics_element_mapping where release_id = $1`,
      [report.catalog_release_id]
    ),
    client.query(
      `select group_id, resolution, time_element_id, inherited_from_group_id
       from catalog.repeating_group_time_mapping
       where release_id = $1
       union all
       select
         custom_group.namespace || '.' || custom_group.slug,
         case when custom_group.temporal_kind = 'clinical' then 'element' else 'non-temporal' end,
         time_identity.canonical_key,
         null::text
       from forms.custom_group_definition custom_group
       left join catalog.element_identity time_identity on time_identity.id = custom_group.clinical_time_element_id
       where custom_group.organization_id = $2`,
      [report.catalog_release_id, report.organization_id]
    ),
    client.query(
      `select a.sequence, ac.action, ac.target_element_occurrence_id, ac.corrected_value
       from clinical.amendment a
       join clinical.amendment_change ac on ac.amendment_id = a.id
       where a.report_id = $1
       order by a.sequence, ac.id`,
      [reportId]
    )
  ]);

  const elementsById = new Map(elementResult.rows.map((row) => [row.id, row]));
  for (const change of amendmentResult.rows) {
    if (change.action === "remove") {
      elementsById.delete(change.target_element_occurrence_id);
      continue;
    }
    if (change.action === "replace") {
      const current = elementsById.get(change.target_element_occurrence_id);
      if (!current) throw new Error(`Amendment replaces missing occurrence ${change.target_element_occurrence_id}`);
      elementsById.set(current.id, amendedRow(current, change.corrected_value));
      continue;
    }
    const added = amendedRow({}, change.corrected_value);
    if (!added.id) throw new Error("An added amendment occurrence requires elementOccurrenceId");
    elementsById.set(added.id, added);
  }

  const elements = [...elementsById.values()];
  const groupById = new Map(groupResult.rows.map((row) => [row.id, row]));
  const mappingByElement = new Map(mappingResult.rows.map((row) => [row.mapping.elementId, row.mapping]));
  const timeByGroup = new Map(timeResult.rows.map((row) => [row.group_id, row]));
  const elementsByGroupAndId = new Map(
    elements.map((row) => [`${row.group_instance_id ?? ""}:${row.element_id}`, row])
  );

  const common = {
    reporting_date: report.reporting_date,
    reporting_date_source: report.reporting_date_source,
    report_id: report.report_id,
    incident_id: report.incident_id,
    organization_id: report.organization_id,
    agency_demographic_version_id: report.agency_demographic_version_id,
    patient_key: report.patient_key,
    patient_key_version: report.patient_key_version,
    form_version_id: report.form_version_id,
    catalog_release_id: report.catalog_release_id,
    catalog_version: report.catalog_version,
    signed_snapshot_id: report.signed_snapshot_id,
    signed_snapshot_sha256: report.signed_snapshot_sha256,
    effective_amendment_sequence: report.amendment_count,
    projector_version: PROJECTOR_VERSION,
    projected_at: new Date()
  };
  const wide = {
    ...common,
    form_version: report.form_version,
    signed_at: report.signed_at,
    last_amended_at: report.last_amended_at,
    amendment_count: report.amendment_count
  };
  const statuses = {};
  const additional = {};
  const additionalIdentifying = {};
  const seenWide = new Set();
  const repeatRows = [];

  for (const element of elements) {
    const mapping = mappingByElement.get(element.element_id);
    const repeatable = mapping?.analyticalLocation === "repeatable" || (!mapping && element.analytical_repeatable);
    if (!repeatable) {
      if (seenWide.has(element.element_id)) throw new Error(`Non-repeatable element ${element.element_id} occurs more than once`);
      seenWide.add(element.element_id);
      if (["null", "pertinent-negative", "absent"].includes(element.value_kind)) {
        statuses[element.element_id] = {
          kind: element.value_kind,
          code: element.absence_code,
          display: element.absence_display
        };
      } else if (mapping) {
        Object.assign(wide, wideValues(element, mapping));
      } else {
        const target = element.identifying ? additionalIdentifying : additional;
        target[element.element_id] = valuePayload(element);
      }
      continue;
    }

    if (!element.group_instance_id) {
      throw new Error(`Repeatable occurrence ${element.id} has no group instance`);
    }
    const group = groupById.get(element.group_instance_id);
    if (!group) throw new Error(`Occurrence ${element.id} references missing group ${element.group_instance_id}`);
    const analyticalGroupPath = mapping?.groupPath ?? [group.group_id];
    const mappedGroup = [...analyticalGroupPath].reverse().find((groupId) => timeByGroup.has(groupId));
    const timeMapping = mappedGroup ? timeByGroup.get(mappedGroup) : null;
    const sourceGroupId =
      timeMapping?.resolution === "inherited" ? timeMapping.inherited_from_group_id : timeMapping?.group_id;
    const sourceGroup = sourceGroupId
      ? ancestorInstance(groupById, element.group_instance_id, sourceGroupId)
      : null;
    const timeElement =
      sourceGroup && timeMapping?.time_element_id
        ? elementsByGroupAndId.get(`${sourceGroup.id}:${timeMapping.time_element_id}`)
        : null;

    repeatRows.push({
      ...common,
      element_identity_id: element.element_identity_id,
      element_id: element.element_id,
      element_occurrence_id: element.id,
      group_id: group.group_id,
      group_instance_id: group.id,
      parent_group_instance_id: group.parent_group_instance_id,
      group_path: analyticalGroupPath,
      instance_path: instancePath(groupById, group.id),
      group_ordinal: group.ordinal,
      element_ordinal: element.ordinal,
      correlation_id: element.correlation_id,
      group_correlation_id: group.correlation_id,
      value_kind: element.value_kind,
      value_text: element.value_text,
      value_integer: element.value_integer,
      value_numeric: element.value_numeric,
      value_boolean: element.value_boolean,
      value_date: element.value_date,
      value_datetime: element.value_datetime,
      value_time: element.value_time,
      value_duration: element.value_duration,
      value_binary: element.value_binary,
      value_lexical: element.value_lexical,
      value_utc_offset_minutes: element.value_utc_offset_minutes,
      value_precision: element.value_precision,
      code: element.code,
      code_system: element.code_system,
      code_display: element.code_display,
      terminology_version: element.terminology_version,
      absence_kind: ["null", "pertinent-negative", "absent"].includes(element.value_kind) ? element.value_kind : null,
      absence_code: element.absence_code,
      absence_display: element.absence_display,
      clinical_time: timeElement?.value_datetime ?? null,
      clinical_time_element_id: timeElement?.element_id ?? null,
      clinical_utc_offset_minutes: timeElement?.value_utc_offset_minutes ?? null,
      clinical_time_precision: timeElement?.value_precision ?? null,
      documented_time: element.documented_time ?? group.documented_time,
      documented_utc_offset_minutes:
        element.documented_utc_offset_minutes ?? group.documented_utc_offset_minutes,
      documented_time_precision: element.documented_precision,
      server_received_time: element.server_received_time,
      normalized_numeric: null,
      normalized_unit_code: null,
      normalization_rule_version: null,
      source_attributes: element.source_attributes,
      quality_flags: null,
      quality_rule_version: null,
      is_identifying: mapping?.identifying ?? element.identifying
    });
  }

  wide.element_statuses = sparseObject(statuses);
  wide.additional_elements = sparseObject(additional);
  wide.additional_identifying_elements = sparseObject(additionalIdentifying);
  wide.quality_flags = null;
  wide.quality_rule_version = null;

  await client.query("select analytics_private.ensure_partitions($1::date, ($1::date + interval '1 day')::date)", [
    report.reporting_date
  ]);
  await client.query("delete from analytics_private.epcr_repeatable_element where report_id = $1", [reportId]);
  await client.query("delete from analytics_private.epcr where report_id = $1", [reportId]);
  await insertOne("analytics_private.epcr", wide);
  await insertMany("analytics_private.epcr_repeatable_element", repeatRows);
}

let processed = 0;
try {
  while (processed < BATCH_SIZE) {
    await client.query("begin");
    const claimed = await client.query(
      `with next_event as (
         select id
         from integration.outbox_event
         where processed_at is null and available_at <= now()
         order by occurred_at
         for update skip locked
         limit 1
       )
       update integration.outbox_event event
       set claimed_at = now(), attempt_count = attempt_count + 1
       from next_event
       where event.id = next_event.id
       returning event.id, event.aggregate_id`,
      []
    );
    if (claimed.rowCount === 0) {
      await client.query("commit");
      break;
    }
    const event = claimed.rows[0];
    try {
      await projectReport(event.aggregate_id);
      await client.query(
        "update integration.outbox_event set processed_at = now(), last_error = null where id = $1",
        [event.id]
      );
      await client.query("commit");
      processed += 1;
    } catch (error) {
      await client.query("rollback");
      await client.query(
        `update integration.outbox_event
         set claimed_at = null,
             attempt_count = attempt_count + 1,
             available_at = now() + least(interval '1 hour', interval '5 seconds' * power(2, least(attempt_count, 10))),
             last_error = left($2, 4000)
         where id = $1`,
        [event.id, error instanceof Error ? error.message : String(error)]
      );
      console.error(`Failed to project report ${event.aggregate_id}:`, error);
      processed += 1;
    }
  }
  console.log(`Processed ${processed} analytical projection event${processed === 1 ? "" : "s"}.`);
} finally {
  await client.end();
}
