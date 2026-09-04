import { createHash } from "node:crypto";
import type { DispatchConflict, EncounterDocument, EncounterValue } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

type JsonRecord = Record<string, unknown>;
type DispatchElement = JsonRecord & { id: string; values: JsonRecord[] };
type DispatchInstance = JsonRecord & { instanceId: string; parentInstanceId?: string; elements: DispatchElement[] };
type DispatchGroup = JsonRecord & { id: string; instances: DispatchInstance[] };

type ReportDocumentRow = {
  id: string;
  created_at: Date | string;
  updated_at: Date | string;
  form_id: string;
  form_version: string | number;
  catalog_standard: string;
  catalog_version: string;
  catalog_dataset: string;
};

type StoredGroupRow = {
  id: string;
  parent_group_instance_id: string | null;
  group_id: string;
  ordinal: string | number;
  documented_time: Date | string | null;
};

type StoredOccurrenceRow = {
  id: string;
  group_instance_id: string;
  element_id: string;
  ordinal: string | number;
  value_kind: string;
  value_text: string | null;
  value_integer: string | number | null;
  value_numeric: string | number | null;
  value_boolean: boolean | null;
  value_date: string | null;
  value_datetime: Date | string | null;
  value_time: string | null;
  value_duration: string | null;
  value_binary: string | null;
  value_lexical: string | null;
  value_utc_offset_minutes: string | number | null;
  value_precision: string | null;
  code: string | null;
  code_system: string | null;
  code_display: string | null;
  absence_code: string | null;
  absence_display: string | null;
  source_attributes: JsonRecord | null;
  provenance_kind: string;
  provenance_detail: JsonRecord | null;
};

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable UUID with the schema-required v4 shape, derived from a report and vendor-owned opaque identity. */
export function dispatchEntityId(reportId: string, identity: string): string {
  const bytes = createHash("sha256").update(`${reportId}\u0000${identity}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function valueColumns(value: JsonRecord, baseDatatype: string): unknown[] {
  const empty = Array<unknown>(19).fill(null);
  const set = (kind: string, index: number, item: unknown): unknown[] => {
    empty[0] = kind;
    empty[index] = item;
    return empty;
  };
  if (value.kind === "coded") {
    empty[0] = "coded"; empty[13] = value.code; empty[14] = value.system ?? null; empty[15] = value.display ?? null;
    return empty;
  }
  if (value.kind === "null") {
    const notValue = record(value.notValue) ? value.notValue : {};
    empty[0] = "null"; empty[17] = notValue.code ?? null; empty[18] = notValue.display ?? null;
    return empty;
  }
  if (value.kind === "pertinent-negative") {
    empty[0] = "pertinent-negative"; empty[17] = value.code; empty[18] = value.display ?? null;
    return empty;
  }
  if (value.kind === "absent") return set("absent", 1, null);
  const scalar = value.value;
  if (baseDatatype === "integer") return set("integer", 2, scalar);
  if (baseDatatype === "decimal") return set("numeric", 3, scalar);
  if (baseDatatype === "boolean") return set("boolean", 4, scalar);
  if (baseDatatype === "date") return set("date", 5, scalar);
  if (baseDatatype === "dateTime") return set("datetime", 6, scalar);
  if (baseDatatype === "time") return set("time", 7, scalar);
  if (baseDatatype === "duration") return set("duration", 8, scalar);
  if (baseDatatype === "binary") return set("binary", 9, Buffer.from(String(scalar), "base64"));
  return set(baseDatatype === "anyURI" ? "uri" : "text", 1, scalar);
}

/** Seeds a newly created report from the accepted dispatch snapshot exactly once. */
export async function seedDispatchEncounter(
  manager: EntityManager,
  reportId: string,
  catalogReleaseId: string,
  authorId: string,
  payload: JsonRecord | null,
  pcrNumber: string
): Promise<void> {
  const suppliedGroups = payload && Array.isArray(payload.groups) ? payload.groups.filter(record) : [];
  const groups: DispatchGroup[] = suppliedGroups.map((group) => ({ ...group, id: String(group.id), instances: Array.isArray(group.instances) ? group.instances.filter(record).map((instance) => ({
    ...instance,
    instanceId: String(instance.instanceId),
    ...(typeof instance.parentInstanceId === "string" ? { parentInstanceId: instance.parentInstanceId } : {}),
    elements: Array.isArray(instance.elements) ? instance.elements.filter(record).map((element) => ({
      ...element,
      id: String(element.id),
      values: element.id === "eRecord.01" ? [] : Array.isArray(element.values) ? element.values.filter(record) : []
    })).filter((element) => Array.isArray(element.values) && element.values.length > 0) : []
  })) : [] })) as DispatchGroup[];

  let pcrInstance: DispatchInstance | undefined = groups.find((group) => group.id === "PatientCareReportGroup")?.instances?.[0];
  if (!pcrInstance) {
    const dataset = { instanceId: "server-dataset", elements: [] };
    const header = { instanceId: "server-header", parentInstanceId: dataset.instanceId, elements: [] };
    pcrInstance = { instanceId: "server-pcr", parentInstanceId: header.instanceId, elements: [] } as DispatchInstance;
    groups.unshift(
      { id: "EMSDataSet", instances: [dataset] },
      { id: "HeaderGroup", instances: [header] },
      { id: "PatientCareReportGroup", instances: [pcrInstance] }
    );
  }
  const parentPcr = pcrInstance;
  let recordGroup: DispatchGroup | undefined = groups.find((group) => group.id === "eRecordSection");
  if (!recordGroup) {
    recordGroup = { id: "eRecordSection", instances: [{ instanceId: "server-record", parentInstanceId: parentPcr.instanceId, elements: [] }] };
    groups.push(recordGroup);
  }
  const recordInstance = recordGroup!.instances[0];
  if (!recordInstance) throw new TypeError("The accepted dispatch eRecordSection has no instance");
  recordInstance.elements = Array.isArray(recordInstance.elements) ? recordInstance.elements : [];
  recordInstance.elements.push({ id: "eRecord.01", values: [{ kind: "scalar", occurrenceId: "server-pcr-number", value: pcrNumber }] });

  const instances = groups.flatMap((group) => (group.instances ?? []).map((instance, ordinal) => ({ groupId: String(group.id), instance, ordinal })));
  const bySourceId = new Map(instances.map(({ instance }) => [String(instance.instanceId), dispatchEntityId(reportId, `group:${String(instance.instanceId)}`)]));
  const pending = [...instances];
  while (pending.length) {
    const index = pending.findIndex(({ instance }) => instance.parentInstanceId === undefined ||
      !pending.some(({ instance: candidate }) => candidate.instanceId === instance.parentInstanceId));
    if (index < 0) throw new TypeError("Accepted dispatch group hierarchy contains a cycle");
    const { groupId, instance, ordinal } = pending.splice(index, 1)[0]!;
    await manager.query(`
      insert into clinical.group_instance
        (id, report_id, catalog_release_id, parent_group_instance_id, group_id, ordinal, created_by)
      values ($1, $2, $3, $4, $5, $6, $7)
    `, [bySourceId.get(String(instance.instanceId)), reportId, catalogReleaseId,
      instance.parentInstanceId === undefined ? null : bySourceId.get(String(instance.parentInstanceId)),
      groupId, ordinal, authorId]);
  }

  const elementIds = [...new Set(instances.flatMap(({ instance }) => Array.isArray(instance.elements)
    ? instance.elements.filter(record).map((element) => String(element.id)) : []))];
  const metadata = await manager.query<Array<{ element_id: string; element_identity_id: string; base_datatype: string; analytical_repeatable: boolean; identifying: boolean }>>(`
    select e.element_id, e.element_identity_id, e.base_datatype,
           m.analytical_location = 'repeatable' as analytical_repeatable, m.identifying
    from catalog.element_definition e join catalog.analytics_element_mapping m
      on m.release_id = e.release_id and m.element_id = e.element_id
    where e.release_id = $1 and e.element_id = any($2::text[])
  `, [catalogReleaseId, elementIds]);
  const definitions = new Map(metadata.map((item) => [item.element_id, item]));
  for (const { instance } of instances) {
    const groupInstanceId = bySourceId.get(String(instance.instanceId))!;
    for (const element of Array.isArray(instance.elements) ? instance.elements.filter(record) : []) {
      const definition = definitions.get(String(element.id));
      if (!definition) throw new TypeError(`Accepted dispatch element ${String(element.id)} is absent from the pinned catalog`);
      for (const [ordinal, value] of (Array.isArray(element.values) ? element.values.filter(record) : []).entries()) {
        const occurrenceId = dispatchEntityId(reportId, `occurrence:${String(value.occurrenceId)}`);
        const columns = valueColumns(value, definition.base_datatype);
        await manager.query(`
          insert into clinical.element_occurrence
            (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id,
             ordinal, analytical_repeatable, identifying, value_kind, value_text, value_integer, value_numeric,
             value_boolean, value_date, value_datetime, value_time, value_duration, value_binary,
             value_lexical, value_utc_offset_minutes, value_precision, code, code_system, code_display,
             terminology_version, absence_code, absence_display, source_attributes,
             provenance_kind, provenance_detail, author_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                  $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
                  $28, $29::jsonb, 'dispatch', $30::jsonb, $31)
        `, [occurrenceId, reportId, catalogReleaseId, groupInstanceId, definition.element_identity_id,
          element.id, ordinal, definition.analytical_repeatable, definition.identifying, ...columns,
          value.attributes ? JSON.stringify(value.attributes) : null,
          JSON.stringify({ sourceOccurrenceId: value.occurrenceId, sourceValue: value }), authorId]);
      }
    }
  }
}

export function storedEncounterValue(row: StoredOccurrenceRow): EncounterValue {
  const source = row.provenance_detail?.sourceValue;
  if (record(source)) return { ...source, occurrenceId: row.id } as EncounterValue;
  const common = { occurrenceId: row.id, ...(row.source_attributes ? { attributes: row.source_attributes } : {}) };
  if (row.value_kind === "coded") return { ...common, kind: "coded", code: row.code!, ...(row.code_system ? { system: row.code_system } : {}), ...(row.code_display ? { display: row.code_display } : {}) } as EncounterValue;
  if (row.value_kind === "null") return { ...common, kind: "null", ...(row.absence_code ? { notValue: { code: row.absence_code, ...(row.absence_display ? { display: row.absence_display } : {}) } } : {}) } as EncounterValue;
  if (row.value_kind === "pertinent-negative") return { ...common, kind: "pertinent-negative", code: row.absence_code!, ...(row.absence_display ? { display: row.absence_display } : {}) } as EncounterValue;
  if (row.value_kind === "absent") return { ...common, kind: "absent" } as EncounterValue;
  const raw = row.value_text ?? row.value_integer ?? row.value_numeric ?? row.value_boolean ?? row.value_date ?? row.value_datetime ?? row.value_time ?? row.value_duration ?? row.value_binary ?? "";
  const value = row.value_datetime instanceof Date ? row.value_datetime.toISOString() : raw;
  return {
    ...common, kind: "scalar", value: row.value_kind === "numeric" ? Number(value) : value as string | number | boolean,
    ...(row.value_lexical != null ? { lexical: row.value_lexical } : {}),
    ...(row.value_utc_offset_minutes != null ? { utcOffsetMinutes: Number(row.value_utc_offset_minutes) } : {}),
    ...(row.value_precision != null ? { precision: row.value_precision } : {}),
  } as EncounterValue;
}

/** Rehydrates the portable encounter document from normalized canonical storage. */
export async function encounterDocument(manager: EntityManager, reportId: string): Promise<EncounterDocument> {
  const reports = await manager.query<ReportDocumentRow[]>(`
    select r.id, r.created_at, r.updated_at, f.id as form_id, fv.version as form_version,
           cr.standard as catalog_standard, cr.version as catalog_version, cr.dataset as catalog_dataset
    from clinical.report r join forms.form_version fv on fv.id = r.form_version_id
    join forms.form f on f.id = fv.form_id join catalog.release cr on cr.id = r.catalog_release_id
    where r.id = $1
  `, [reportId]);
  const report = reports[0];
  if (!report) throw new TypeError(`Report ${reportId} is unavailable`);
  const groups = await manager.query<StoredGroupRow[]>(`
    select id, parent_group_instance_id, group_id, ordinal, documented_time from clinical.group_instance
    where report_id = $1 and tombstoned_at is null order by group_id, ordinal, id
  `, [reportId]);
  const occurrences = await manager.query<StoredOccurrenceRow[]>(`
    select id, group_instance_id, element_id, ordinal, value_kind, value_text, value_integer,
           value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration,
           encode(value_binary, 'base64') as value_binary, value_lexical, value_utc_offset_minutes,
           value_precision, code, code_system, code_display,
           absence_code, absence_display, source_attributes, provenance_kind, provenance_detail
    from clinical.element_occurrence where report_id = $1 and tombstoned_at is null
    order by element_id, ordinal, id
  `, [reportId]);
  const byGroup = new Map<string, { id: string; instances: Array<{ instanceId: string; parentInstanceId?: string; attributes?: Record<string, string>; elements: Array<{ id: string; values: EncounterValue[] }> }> }>();
  for (const group of groups) {
    const target = byGroup.get(group.group_id) ?? { id: group.group_id, instances: [] };
    const groupOccurrences = occurrences.filter((item) => item.group_instance_id === group.id);
    const clinicianOwned = groupOccurrences.some((item) => item.provenance_kind === "clinician");
    const attributes = {
      ...(clinicianOwned ? { "x-open-triage-owner": "clinician" } : {}),
      ...(group.documented_time ? { documentedTime: new Date(group.documented_time).toISOString() } : {}),
    };
    const instance = {
      instanceId: group.id,
      ...(group.parent_group_instance_id ? { parentInstanceId: group.parent_group_instance_id } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
      elements: [] as Array<{ id: string; values: EncounterValue[] }>,
    };
    for (const occurrence of groupOccurrences) {
      let element = instance.elements.find((item) => item.id === occurrence.element_id);
      if (!element) { element = { id: occurrence.element_id, values: [] }; instance.elements.push(element); }
      element.values.push(storedEncounterValue(occurrence));
    }
    target.instances.push(instance); byGroup.set(group.group_id, target);
  }
  return {
    $schema: "./encounter-document.schema-1.0.0.json",
    documentType: "open-triage.encounter",
    modelVersion: "1.1.0",
    dataModel: { standard: "NEMSIS", version: report.catalog_version, dataset: "EMSDataSet" },
    formProfile: { id: report.form_id, version: String(report.form_version) },
    encounter: { id: report.id, createdAt: new Date(report.created_at).toISOString(), updatedAt: new Date(report.updated_at).toISOString() },
    groups: [...byGroup.values()]
  };
}

export async function dispatchConflicts(manager: EntityManager, reportId: string): Promise<DispatchConflict[]> {
  const rows = await manager.query<Array<{
    id: string; occurrence_id: string; element_id: string; clinician_value: EncounterValue | null;
    dispatch_value: EncounterValue | null; dispatch_revision: string | number; dispatch_receipt_id: string;
    disposition: DispatchConflict["disposition"]; created_at: Date | string; resolved_at: Date | string | null;
  }>>(`
    select id, occurrence_id, element_id, clinician_value, dispatch_value, dispatch_revision,
           dispatch_receipt_id, disposition, created_at, resolved_at
    from clinical.dispatch_conflict where report_id = $1 order by created_at, id
  `, [reportId]);
  return rows.map((row) => ({
    id: row.id, occurrenceId: row.occurrence_id, elementId: row.element_id,
    clinicianValue: row.clinician_value, dispatchValue: row.dispatch_value,
    dispatchRevision: Number(row.dispatch_revision), receiptId: row.dispatch_receipt_id,
    disposition: row.disposition, createdAt: new Date(row.created_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null
  }));
}
