import { randomUUID } from "node:crypto";
import type { EncounterValue } from "@open-triage/contracts";
import type { DispatchReceiptWriter } from "./dispatch-receipt.persistence.js";
import { dispatchEntityId } from "../reports/encounter-document.persistence.js";

type JsonRecord = Record<string, unknown>;
type IncomingTarget = { occurrenceId: string; elementId: string; groupInstanceId: string; ordinal: number; value: JsonRecord };
type CurrentTarget = { id: string; elementId: string; provenanceKind: string; clinicianValue?: unknown; tombstoned: boolean };

export type DispatchMergeAction =
  | { kind: "apply"; target: IncomingTarget }
  | { kind: "retract"; occurrenceId: string; elementId: string }
  | { kind: "conflict"; occurrenceId: string; elementId: string; clinicianValue: unknown; dispatchValue: JsonRecord | null };

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).filter((key) => key !== "occurrenceId").sort().map((key) => [key, stable(value[key])]));
}

function encounterValue(candidate: unknown): unknown {
  if (!record(candidate)) return candidate;
  if (["text", "uri", "integer", "numeric", "boolean", "date", "datetime", "time", "duration", "binary"].includes(String(candidate.kind))) {
    return { kind: "scalar", value: candidate.value };
  }
  if (candidate.kind === "coded") return {
    kind: "coded", code: candidate.code, system: candidate.system ?? candidate.codeSystem ?? null,
    ...(candidate.display ? { display: candidate.display } : {})
  };
  if (candidate.kind === "null") {
    const notValue = record(candidate.notValue) ? candidate.notValue : {};
    const code = candidate.absenceCode ?? notValue.code;
    return code ? { kind: "null", notValue: { code, ...(candidate.display ?? notValue.display ? { display: candidate.display ?? notValue.display } : {}) } }
      : { kind: "absent" };
  }
  if (candidate.kind === "pertinent-negative") return {
    kind: "pertinent-negative", code: candidate.code ?? candidate.absenceCode,
    ...(candidate.display ? { display: candidate.display } : {})
  };
  return { kind: candidate.kind };
}

function equalValue(left: unknown, right: unknown): boolean {
  const comparable = (candidate: unknown): unknown => {
    const normalized = encounterValue(candidate);
    if (!record(normalized)) return normalized;
    if (normalized.kind === "coded") return { kind: normalized.kind, code: normalized.code, system: normalized.system ?? null };
    if (normalized.kind === "null") return { kind: normalized.kind, code: record(normalized.notValue) ? normalized.notValue.code : null };
    if (normalized.kind === "pertinent-negative") return { kind: normalized.kind, code: normalized.code };
    return normalized;
  };
  return JSON.stringify(stable(comparable(left))) === JSON.stringify(stable(comparable(right)));
}

/** Pure ownership policy used by database ingestion and contract tests. */
export function planDispatchMerge(current: ReadonlyArray<CurrentTarget>, incoming: ReadonlyArray<IncomingTarget>): DispatchMergeAction[] {
  const existing = new Map(current.map((target) => [target.id, target]));
  const next = new Map(incoming.map((target) => [target.occurrenceId, target]));
  const actions: DispatchMergeAction[] = [];
  for (const target of incoming) {
    const prior = existing.get(target.occurrenceId);
    if (!prior || prior.provenanceKind === "dispatch") actions.push({ kind: "apply", target });
    else if (!equalValue(prior.clinicianValue, target.value)) actions.push({
      kind: "conflict", occurrenceId: target.occurrenceId, elementId: target.elementId,
      clinicianValue: prior.clinicianValue ?? null, dispatchValue: target.value
    });
  }
  for (const prior of current) {
    if (next.has(prior.id) || prior.tombstoned) continue;
    if (prior.provenanceKind === "dispatch") actions.push({ kind: "retract", occurrenceId: prior.id, elementId: prior.elementId });
    else actions.push({ kind: "conflict", occurrenceId: prior.id, elementId: prior.elementId,
      clinicianValue: prior.clinicianValue ?? null, dispatchValue: null });
  }
  return actions;
}

function incomingTargets(reportId: string, canonical: JsonRecord): IncomingTarget[] {
  const targets: IncomingTarget[] = [];
  for (const group of Array.isArray(canonical.groups) ? canonical.groups : []) {
    if (!record(group) || !Array.isArray(group.instances)) continue;
    for (const instance of group.instances) {
      if (!record(instance) || typeof instance.instanceId !== "string" || !Array.isArray(instance.elements)) continue;
      for (const element of instance.elements) {
        if (!record(element) || typeof element.id !== "string" || element.id === "eRecord.01" || !Array.isArray(element.values)) continue;
        const elementId = element.id;
        element.values.filter(record).forEach((value, ordinal) => targets.push({
          occurrenceId: dispatchEntityId(reportId, `occurrence:${String(value.occurrenceId)}`),
          elementId,
          groupInstanceId: dispatchEntityId(reportId, `group:${instance.instanceId}`), ordinal, value
        }));
      }
    }
  }
  return targets;
}

function columns(value: JsonRecord, base: string): Record<string, unknown> {
  const result: Record<string, unknown> = {
    value_kind: value.kind, value_text: null, value_integer: null, value_numeric: null,
    value_boolean: null, value_date: null, value_datetime: null, value_time: null, value_duration: null,
    value_binary: null, value_lexical: null, value_utc_offset_minutes: null, value_precision: null,
    code: null, code_system: null, code_display: null, absence_code: null, absence_display: null
  };
  if (value.kind === "coded") Object.assign(result, { code: value.code, code_system: value.system ?? null, code_display: value.display ?? null });
  else if (value.kind === "null") {
    const nv = record(value.notValue) ? value.notValue : {};
    Object.assign(result, { absence_code: nv.code ?? null, absence_display: nv.display ?? null });
  } else if (value.kind === "pertinent-negative") Object.assign(result, { absence_code: value.code, absence_display: value.display ?? null });
  else if (value.kind === "scalar") {
    const key = base === "integer" ? "value_integer" : base === "decimal" ? "value_numeric"
      : base === "boolean" ? "value_boolean" : base === "date" ? "value_date"
        : base === "dateTime" ? "value_datetime" : base === "time" ? "value_time"
          : base === "duration" ? "value_duration" : base === "binary" ? "value_binary" : "value_text";
    result.value_kind = base === "dateTime" ? "datetime" : base === "anyURI" ? "uri" : base === "string" ? "text" : base;
    result[key] = base === "binary" ? Buffer.from(String(value.value), "base64") : value.value;
    if (["integer", "decimal", "duration"].includes(base)) result.value_lexical = value.lexical ?? String(value.value);
    if (["date", "dateTime", "time"].includes(base)) result.value_precision = value.precision ?? null;
    if (["dateTime", "time"].includes(base)) result.value_utc_offset_minutes = value.utcOffsetMinutes ?? null;
  }
  return result;
}

/** Applies a validated complete snapshot to an already-open draft under occurrence ownership rules. */
export async function mergeDispatchEncounter(writer: DispatchReceiptWriter, input: {
  reportId: string; canonical: JsonRecord; receiptId: string; dispatchRevision: number;
}): Promise<{ applied: number; conflicts: number; revision: number }> {
  const reports = await writer.query<Array<{ catalog_release_id: string; documenting_user_id: string; revision: string | number }>>(
    "select catalog_release_id, documenting_user_id, revision from clinical.report where id = $1 and status = 'draft' for update",
    [input.reportId]
  );
  const report = reports[0];
  if (!report) return { applied: 0, conflicts: 0, revision: 0 };
  const incoming = incomingTargets(input.reportId, input.canonical);
  const rows = await writer.query<Array<{ id: string; element_id: string; provenance_kind: string; provenance_detail: JsonRecord | null; tombstoned_at: unknown }>>(`
    select id, element_id, provenance_kind, provenance_detail, tombstoned_at
    from clinical.element_occurrence where report_id = $1
      and (provenance_kind = 'dispatch' or provenance_detail ? 'sourceOccurrenceId')
      and id <> $2 for update
  `, [input.reportId, dispatchEntityId(input.reportId, "occurrence:server-pcr-number")]);
  const current: CurrentTarget[] = rows.map((row) => ({ id: row.id, elementId: row.element_id,
    provenanceKind: row.provenance_kind, clinicianValue: row.provenance_detail?.clinicianValue,
    tombstoned: row.tombstoned_at !== null }));
  const actions = planDispatchMerge(current, incoming);
  const elementIds = [...new Set(incoming.map((target) => target.elementId))];
  const definitions = await writer.query<Array<{ element_id: string; element_identity_id: string; base_datatype: string; analytical_repeatable: boolean; identifying: boolean }>>(`
    select e.element_id, e.element_identity_id, e.base_datatype,
           m.analytical_location = 'repeatable' as analytical_repeatable, m.identifying
    from catalog.element_definition e join catalog.analytics_element_mapping m
      on m.release_id = e.release_id and m.element_id = e.element_id
    where e.release_id = $1 and e.element_id = any($2::text[])
  `, [report.catalog_release_id, elementIds]);
  const byElement = new Map(definitions.map((item) => [item.element_id, item]));
  for (const action of actions) {
    if (action.kind === "retract") {
      await writer.query("update clinical.element_occurrence set tombstoned_at = now(), updated_at = now() where report_id = $1 and id = $2 and provenance_kind = 'dispatch'", [input.reportId, action.occurrenceId]);
      continue;
    }
    if (action.kind === "conflict") {
      await writer.query(`insert into clinical.dispatch_conflict
        (report_id, occurrence_id, element_id, clinician_value, dispatch_value, clinician_lineage,
         dispatch_receipt_id, dispatch_revision)
        select $1, id, $3, $4::jsonb, $5::jsonb, coalesce(provenance_detail, '{}'::jsonb), $6, $7
        from clinical.element_occurrence where report_id = $1 and id = $2
        on conflict (report_id, occurrence_id, dispatch_revision) do nothing`,
      [input.reportId, action.occurrenceId, action.elementId, JSON.stringify(encounterValue(action.clinicianValue)),
        action.dispatchValue === null ? null : JSON.stringify(action.dispatchValue), input.receiptId, input.dispatchRevision]);
      continue;
    }
    const definition = byElement.get(action.target.elementId);
    if (!definition) throw new TypeError(`Dispatch target ${action.target.elementId} is absent from the pinned report catalog`);
    const value = columns(action.target.value, definition.base_datatype);
    await writer.query(`insert into clinical.element_occurrence
      (id, report_id, catalog_release_id, group_instance_id, element_identity_id, element_id, ordinal,
       analytical_repeatable, identifying, value_kind, value_text, value_integer, value_numeric,
       value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, value_lexical,
       value_utc_offset_minutes, value_precision, code, code_system, code_display,
       absence_code, absence_display, source_attributes, provenance_kind, provenance_detail, author_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,'dispatch',$28::jsonb,$29)
      on conflict (id) do update set value_kind=excluded.value_kind, value_text=excluded.value_text,
       value_integer=excluded.value_integer, value_numeric=excluded.value_numeric, value_boolean=excluded.value_boolean,
       value_date=excluded.value_date, value_datetime=excluded.value_datetime, value_time=excluded.value_time,
       value_duration=excluded.value_duration, value_binary=excluded.value_binary,
       value_lexical=excluded.value_lexical, value_utc_offset_minutes=excluded.value_utc_offset_minutes,
       value_precision=excluded.value_precision,
       code=excluded.code, code_system=excluded.code_system, code_display=excluded.code_display,
       absence_code=excluded.absence_code, absence_display=excluded.absence_display,
       source_attributes=excluded.source_attributes, provenance_detail=excluded.provenance_detail,
       ordinal=excluded.ordinal, tombstoned_at=null, updated_at=now()
      where clinical.element_occurrence.report_id=excluded.report_id and clinical.element_occurrence.provenance_kind='dispatch'`,
    [action.target.occurrenceId, input.reportId, report.catalog_release_id, action.target.groupInstanceId,
      definition.element_identity_id, action.target.elementId, action.target.ordinal,
      definition.analytical_repeatable, definition.identifying, value.value_kind, value.value_text,
      value.value_integer, value.value_numeric, value.value_boolean, value.value_date, value.value_datetime,
      value.value_time, value.value_duration, value.value_binary, value.value_lexical,
      value.value_utc_offset_minutes, value.value_precision, value.code, value.code_system, value.code_display,
      value.absence_code, value.absence_display, action.target.value.attributes ? JSON.stringify(action.target.value.attributes) : null,
      JSON.stringify({ sourceOccurrenceId: action.target.value.occurrenceId, sourceValue: action.target.value,
        dispatchReceiptId: input.receiptId, dispatchRevision: input.dispatchRevision }), report.documenting_user_id]);
  }
  const changed = actions.length;
  const revision = Number(report.revision) + (changed ? 1 : 0);
  if (changed) {
    await writer.query("update clinical.report set revision = $2, updated_at = now() where id = $1", [input.reportId, revision]);
    await writer.query(`insert into clinical.report_change
      (report_id, revision, idempotency_key, author_id, changes)
      values ($1,$2,$3,$4,$5::jsonb)`, [input.reportId, revision, input.receiptId,
      report.documenting_user_id, JSON.stringify({ dispatchRevision: input.dispatchRevision, actions })]);
  }
  return { applied: actions.filter(({ kind }) => kind !== "conflict").length,
    conflicts: actions.filter(({ kind }) => kind === "conflict").length, revision };
}
