import pg from "pg";
import {
  evaluateQualityAndNormalization,
  NORMALIZATION_RULE_VERSION,
  QUALITY_RULE_VERSION
} from "@open-triage/contracts/quality-rules";

const databaseUrl = process.env.DATABASE_URL;
const PROJECTOR_VERSION = "1.0.0";
const BATCH_SIZE = Number.parseInt(process.env.ANALYTICS_PROJECTOR_BATCH_SIZE ?? "100", 10);
const MAX_ATTEMPTS = Number.parseInt(process.env.ANALYTICS_PROJECTOR_MAX_ATTEMPTS ?? "12", 10);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!databaseUrl) throw new Error("DATABASE_URL is required to project analytics");
if (!Number.isInteger(BATCH_SIZE) || BATCH_SIZE < 1 || BATCH_SIZE > 1000) {
  throw new Error("ANALYTICS_PROJECTOR_BATCH_SIZE must be an integer from 1 through 1000");
}
if (!Number.isInteger(MAX_ATTEMPTS) || MAX_ATTEMPTS < 1 || MAX_ATTEMPTS > 100) {
  throw new Error("ANALYTICS_PROJECTOR_MAX_ATTEMPTS must be an integer from 1 through 100");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

function parseArguments(args) {
  const options = { mode: "queue" };
  let selectedMode = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (["--replay", "--backfill", "--report", "--from", "--to"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--replay") {
        if (selectedMode) throw new Error("projector modes cannot be combined");
        selectedMode = "replay";
        options.mode = "replay";
        options.reportId = value;
      } else if (argument === "--backfill") {
        if (selectedMode) throw new Error("projector modes cannot be combined");
        selectedMode = "backfill";
        options.mode = "backfill";
        options.jobId = value;
      } else if (argument === "--report") options.reportId = value;
      else if (argument === "--from") options.from = value;
      else options.to = value;
      continue;
    }
    if (argument === "--reconcile") {
      if (selectedMode) throw new Error("projector modes cannot be combined");
      selectedMode = "reconcile";
      options.mode = "reconcile";
      continue;
    }
    throw new Error(`Unknown projector argument: ${argument}`);
  }
  if (options.reportId && !uuidPattern.test(options.reportId)) throw new Error("report ID must be a UUID");
  if (options.jobId && (options.jobId.trim().length < 1 || options.jobId.length > 200)) {
    throw new Error("backfill job key must contain 1 through 200 characters");
  }
  for (const [name, value] of [["from", options.from], ["to", options.to]]) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD`);
  }
  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new Error("--from and --to must be supplied together");
  }
  if (options.from && options.from > options.to) throw new Error("--from must not be after --to");
  if (options.mode === "queue" && (options.reportId || options.from)) {
    throw new Error("selection arguments require --reconcile or --backfill");
  }
  if (options.mode === "replay" && (options.from || options.to)) {
    throw new Error("--replay cannot be combined with a date range");
  }
  if (["reconcile", "backfill"].includes(options.mode) && Boolean(options.reportId) === Boolean(options.from)) {
    throw new Error(`${options.mode} requires exactly one of --report or --from/--to`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));

function safeErrorCode(error) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return `database.${error.code.slice(0, 32)}`;
  }
  const name = error instanceof Error ? error.name : "UnknownError";
  return `projector.${name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "UnknownError"}`;
}

function logRun(metrics) {
  console.log(JSON.stringify({ event: "analytics_projection_run", ...metrics }));
}

async function startRun(mode) {
  return (await client.query(
    "insert into integration.projection_run (mode) values ($1) returning id",
    [mode]
  )).rows[0].id;
}

async function finishRun(runId, status, metrics = {}, errorCode = null) {
  await client.query(
    `update integration.projection_run
     set status = $2, completed_at = clock_timestamp(), processed_count = $3,
         failed_count = $4, checked_count = $5, repaired_count = $6, error_code = $7
     where id = $1`,
    [runId, status, metrics.processedCount ?? 0, metrics.failedCount ?? 0,
      metrics.checkedCount ?? 0, metrics.repairedCount ?? 0, errorCode]
  );
}

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

async function projectReport(reportId, { onlyIfStale = false } = {}) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [reportId]);
  const reportResult = await client.query(
    `select
       r.id as report_id,
       coalesce(date_correction.reporting_date, r.reporting_date) as reporting_date,
       coalesce(date_correction.reporting_date_source, r.reporting_date_source) as reporting_date_source,
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
     left join lateral (
       select correction.reporting_date, correction.reporting_date_source
       from clinical.amendment correction
       where correction.report_id = r.id and correction.reporting_date is not null
       order by correction.sequence desc
       limit 1
     ) date_correction on true
     where r.id = $1 and r.status = 'signed'
     group by r.id, p.pseudonymous_key, p.pseudonymous_key_version, fv.id, cr.version, ss.id,
       date_correction.reporting_date, date_correction.reporting_date_source`,
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
  const quality = evaluateQualityAndNormalization(elements.map((element) => ({
    id: element.id,
    elementId: element.element_id,
    valueKind: element.value_kind,
    valueInteger: element.value_integer,
    valueNumeric: element.value_numeric,
    sourceAttributes: element.source_attributes
  })));
  const findingsByOccurrence = new Map();
  for (const finding of quality.qualityFindings) {
    findingsByOccurrence.set(finding.sourceOccurrenceId,
      [...(findingsByOccurrence.get(finding.sourceOccurrenceId) ?? []), finding]);
  }
  const derivedByOccurrence = new Map(
    quality.derivedValues.map((derived) => [derived.sourceOccurrenceId, derived])
  );
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
    const elementFindings = findingsByOccurrence.get(element.id) ?? [];
    const elementDerived = derivedByOccurrence.get(element.id) ?? null;
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
      normalized_numeric: elementDerived?.derivedNumeric ?? null,
      source_unit_code: elementDerived?.sourceUnitCode ?? elementFindings[0]?.sourceUnitCode ?? null,
      normalized_unit_code: elementDerived?.derivedUnitCode ?? null,
      normalization_rule_id: elementDerived?.ruleId ?? null,
      normalization_rule_version: elementDerived?.ruleVersion ?? null,
      source_attributes: element.source_attributes,
      quality_flags: elementFindings.length ? elementFindings.map((finding) => finding.code) : null,
      quality_rule_version: elementFindings.length ? QUALITY_RULE_VERSION : null,
      quality_findings: elementFindings.length ? JSON.stringify(elementFindings) : null,
      is_identifying: mapping?.identifying ?? element.identifying
    });
  }

  wide.element_statuses = sparseObject(statuses);
  wide.additional_elements = sparseObject(additional);
  wide.additional_identifying_elements = sparseObject(additionalIdentifying);
  wide.quality_flags = quality.qualityFindings.length
    ? [...new Set(quality.qualityFindings.map((finding) => finding.code))]
    : null;
  wide.quality_rule_version = QUALITY_RULE_VERSION;
  wide.quality_findings = quality.qualityFindings.length
    ? JSON.stringify(quality.qualityFindings)
    : null;
  wide.derived_values = quality.derivedValues.length
    ? JSON.stringify(quality.derivedValues)
    : null;
  wide.normalization_rule_version = NORMALIZATION_RULE_VERSION;

  if (onlyIfStale) {
    const status = (await client.query(
      `select
        (select count(*) = 1 and bool_and(
           reporting_date = $2::date and signed_snapshot_id = $3
           and effective_amendment_sequence = $4 and projector_version = $5)
         from analytics_private.epcr where report_id = $1) as wide_current,
        (select count(*) = $6 and coalesce(bool_and(
           reporting_date = $2::date and signed_snapshot_id = $3
           and effective_amendment_sequence = $4 and projector_version = $5), true)
         from analytics_private.epcr_repeatable_element where report_id = $1) as repeatable_current`,
      [reportId, report.reporting_date, report.signed_snapshot_id, report.amendment_count,
        PROJECTOR_VERSION, repeatRows.length]
    )).rows[0];
    if (status.wide_current && status.repeatable_current) {
      return { report, repeatableCount: repeatRows.length, repaired: false };
    }
  }

  await client.query("select analytics_private.ensure_partitions($1::date, ($1::date + interval '1 day')::date)", [
    report.reporting_date
  ]);
  await client.query("delete from analytics_private.epcr_repeatable_element where report_id = $1", [reportId]);
  await client.query("delete from analytics_private.epcr where report_id = $1", [reportId]);
  if (process.env.ANALYTICS_PROJECTOR_FAIL_AFTER_DELETE === "1") {
    throw new Error("Injected analytical projection failure after delete");
  }
  await insertOne("analytics_private.epcr", wide);
  await insertMany("analytics_private.epcr_repeatable_element", repeatRows);
  return { report, repeatableCount: repeatRows.length, repaired: true };
}

async function inTransaction(operation) {
  await client.query("begin");
  try {
    const result = await operation();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

function selectionSql(selection, afterCursor = false) {
  const parameters = [];
  let predicate;
  if (selection.reportId) {
    parameters.push(selection.reportId);
    predicate = `r.id = $${parameters.length}`;
  } else {
    parameters.push(selection.from, selection.to);
    predicate = `effective.reporting_date between $1::date and $2::date`;
  }
  if (afterCursor && selection.cursorReportingDate) {
    parameters.push(selection.cursorReportingDate, selection.cursorReportId);
    predicate += ` and (effective.reporting_date, r.id) > ($${parameters.length - 1}::date, $${parameters.length}::uuid)`;
  }
  return {
    parameters,
    sql: `select r.id, effective.reporting_date::text
      from clinical.report r
      cross join lateral (
        select coalesce((
          select amendment.reporting_date
          from clinical.amendment amendment
          where amendment.report_id = r.id and amendment.reporting_date is not null
          order by amendment.sequence desc limit 1
        ), r.reporting_date) as reporting_date
      ) effective
      where r.status = 'signed' and ${predicate}
      order by effective.reporting_date, r.id`
  };
}

async function runQueue() {
  let attempted = 0;
  let processedCount = 0;
  let failedCount = 0;
  while (attempted < BATCH_SIZE) {
    await client.query("begin");
    const claimed = await client.query(
      `with next_event as (
         select id
         from integration.outbox_event
         where processed_at is null and failed_at is null and available_at <= now()
         order by occurred_at
         for update skip locked
         limit 1
       )
       update integration.outbox_event event
       set claimed_at = now(), attempt_count = attempt_count + 1
       from next_event
       where event.id = next_event.id
       returning event.id, event.aggregate_id`
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
      processedCount += 1;
    } catch (error) {
      await client.query("rollback");
      const errorCode = safeErrorCode(error);
      await client.query(
        `update integration.outbox_event
         set claimed_at = null,
             attempt_count = attempt_count + 1,
             available_at = now() + least(interval '1 hour', interval '5 seconds' * power(2, least(attempt_count, 10))),
             failed_at = case when attempt_count + 1 >= $3 then now() else null end,
             last_error = $2
         where id = $1`,
        [event.id, errorCode, MAX_ATTEMPTS]
      );
      failedCount += 1;
    }
    attempted += 1;
  }
  return { processedCount, failedCount, checkedCount: attempted };
}

async function runReplay(reportId) {
  await inTransaction(() => projectReport(reportId));
  return { processedCount: 1 };
}

async function runReconciliation(selection) {
  const query = selectionSql(selection);
  const reports = await client.query(query.sql, query.parameters);
  let repaired = 0;
  for (const report of reports.rows) {
    const result = await inTransaction(() => projectReport(report.id, { onlyIfStale: true }));
    if (result.repaired) repaired += 1;
  }
  return { processedCount: repaired, checkedCount: reports.rowCount, repairedCount: repaired };
}

async function loadBackfillJob(selection) {
  await client.query(
    `insert into integration.projection_backfill_job (id, report_id, start_date, end_date)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [selection.jobId, selection.reportId ?? null, selection.from ?? null, selection.to ?? null]
  );
  const result = await client.query(
    `select id, report_id, start_date::text, end_date::text,
       cursor_reporting_date::text, cursor_report_id, processed_count, completed_at
     from integration.projection_backfill_job where id = $1`,
    [selection.jobId]
  );
  const job = result.rows[0];
  if (!job || job.report_id !== (selection.reportId ?? null) || job.start_date !== (selection.from ?? null) ||
      job.end_date !== (selection.to ?? null)) {
    throw new Error(`Backfill job ${selection.jobId} already exists with a different selection`);
  }
  return job;
}

async function runBackfill(selection) {
  let job = await loadBackfillJob(selection);
  if (job.completed_at) {
    return { processedCount: 0, checkedCount: 0, totalProcessedCount: job.processed_count, complete: true };
  }
  let processedThisRun = 0;
  while (processedThisRun < BATCH_SIZE) {
    const next = await inTransaction(async () => {
      const current = (await client.query(
        `select cursor_reporting_date::text, cursor_report_id
         from integration.projection_backfill_job where id = $1 for update`,
        [selection.jobId]
      )).rows[0];
      const query = selectionSql({
        ...selection,
        cursorReportingDate: current.cursor_reporting_date,
        cursorReportId: current.cursor_report_id
      }, true);
      const report = (await client.query(`${query.sql} limit 1`, query.parameters)).rows[0];
      if (!report) {
        await client.query(
          `update integration.projection_backfill_job
           set completed_at = now(), updated_at = now() where id = $1`,
          [selection.jobId]
        );
        return null;
      }
      await projectReport(report.id);
      await client.query(
        `update integration.projection_backfill_job
         set cursor_reporting_date = $2, cursor_report_id = $3,
             processed_count = processed_count + 1, updated_at = now()
         where id = $1`,
        [selection.jobId, report.reporting_date, report.id]
      );
      return report;
    });
    if (!next) break;
    processedThisRun += 1;
    if (process.env.ANALYTICS_PROJECTOR_INTERRUPT_AFTER &&
        processedThisRun >= Number.parseInt(process.env.ANALYTICS_PROJECTOR_INTERRUPT_AFTER, 10)) break;
  }
  job = await loadBackfillJob(selection);
  return {
    processedCount: processedThisRun,
    checkedCount: processedThisRun,
    totalProcessedCount: job.processed_count,
    complete: Boolean(job.completed_at)
  };
}

let runId;
try {
  runId = await startRun(options.mode);
  let metrics;
  if (options.mode === "queue") metrics = await runQueue();
  else if (options.mode === "replay") metrics = await runReplay(options.reportId);
  else if (options.mode === "reconcile") metrics = await runReconciliation(options);
  else metrics = await runBackfill(options);
  const status = metrics.failedCount > 0 ? "partial" : "succeeded";
  await finishRun(runId, status, metrics);
  logRun({ mode: options.mode, status, ...metrics });
} catch (error) {
  const errorCode = safeErrorCode(error);
  if (runId) {
    try {
      await finishRun(runId, "failed", {}, errorCode);
    } catch {
      // The structured log still exposes the failed job if run recording is unavailable.
    }
  }
  logRun({ mode: options.mode, status: "failed", errorCode });
  process.exitCode = 1;
} finally {
  await client.end();
}
