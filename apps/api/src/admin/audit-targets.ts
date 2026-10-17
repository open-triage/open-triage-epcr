import type { AuditOrganization, AuditTarget, AuditTargetKind } from "@open-triage/contracts";
import type { EntityManager } from "typeorm";

export const auditTargetKinds: Record<string, AuditTargetKind> = {
  "clinical_audit.patient_access_event": "report",
  "clinical_audit.analytics_access_event": "analytics",
  "app_identity.authentication_event": "user",
  "app_identity.operator_identity_event": "user",
  "app_identity.ownership_transfer_event": "ownershipTransfer",
  "app_identity.organization_event": "organization",
  "app_identity.configuration_event": "form",
  "catalog.publication_event": "catalog",
  "validation.change_event": "validation",
  "app_identity.agency_settings_change_event": "organization",
  "app_identity.agency_demographic_change_event": "demographics",
  "clinical_audit.event": "report",
  "clinical.report_change": "report",
  "clinical_audit.draft_reconciliation": "report",
  "clinical_audit.report_note_mutation_event": "report",
  "clinical_audit.post_signature_audit_note": "report",
  "clinical_audit.report_media_access_event": "report",
  "offline_recovery.event": "report",
  "offline_recovery.key_lifecycle_event": "report",
  "offline_recovery.report_recovery_event": "report",
  "clinical.review_assignment_history": "reviewItem",
  "clinical.review_overdue_history": "reviewItem",
  "clinical.review_progress_history": "reviewItem",
  "clinical.review_saved_analysis_history": "analysis",
  "clinical.review_criterion_route_history": "criterion",
  "clinical.review_amendment_policy_history": "organization",
  "clinical.review_overdue_policy_history": "organization",
  "clinical_audit.synthetic_generation_event": "call",
  "clinical_audit.synthetic_draft_mutation_event": "report",
  "app_identity.installation_event": "installation",
  "app_identity.operational_unit_event": "unit",
  "feedback.submission": "feedback",
  "feedback.review_event": "feedback",
  "clinical_audit.audit_read_event": "record",
};

const reportNumber = (alias: "r" | "t") => `(select value.value_text from clinical.element_occurrence value
  where value.report_id=${alias}.id and value.element_id='eRecord.01' and value.tombstoned_at is null
  order by value.ordinal,value.id limit 1)`;

// Only allowlisted metadata is returned. No patient names, notes, clinical values,
// feedback descriptions, credentials, or arbitrary event payloads are projected.
// Every lookup uses the type and IDs from an already authorized, bounded page.
const lookups: Partial<Record<AuditTargetKind, { from: string; label: string; version?: string; scope?: string; time?: string }>> = {
  user: { from: "app_identity.agency_user t", label: "t.display_name" },
  role: { from: "app_identity.role t", label: "t.display_name" },
  roleVersion: { from: "app_identity.role_version t", label: "t.display_name", version: "t.version" },
  organization: { from: "app_identity.organization t", label: "t.name", scope: "t.id=$1" },
  ownershipTransfer: { from: "app_identity.ownership_transfer t join app_identity.app_user u on u.id=t.nominee_user_id", label: "u.display_name" },
  form: { from: "forms.form_version t join forms.form f on f.id=t.form_id", label: "f.name", version: "t.version", scope: "f.organization_id=$1" },
  // Releases are shared catalog metadata; only IDs referenced by this agency's events are supplied.
  catalog: { from: "catalog.release t", label: "concat_ws(' · ',t.standard,t.version,t.dataset)", scope: "$1::uuid is not null" },
  validation: { from: "validation.version t", label: "t.display_name", version: "t.version" },
  demographics: { from: "app_identity.agency_demographic_version t join app_identity.organization o on o.id=t.organization_id", label: "o.name", version: "t.version" },
  report: { from: "clinical.report t", label: reportNumber("t") },
  reviewItem: { from: "clinical.review_item t join clinical.report r on r.id=t.report_id and r.organization_id=t.organization_id", label: reportNumber("r") },
  analysis: { from: "clinical.review_saved_analysis t", label: "t.name" },
  criterion: { from: "validation.rule_identity t", label: `(select v.display_name from validation.version v
    where v.organization_id=t.organization_id and v.rule_id=t.id order by v.updated_at desc,v.id desc limit 1)` },
  call: { from: "clinical.call_assignment t", label: "t.call_number" },
  installation: { from: "app_identity.installation_registration t", label: "t.name" },
  unit: { from: "app_identity.operational_unit t", label: "concat_ws(' · ',t.call_sign,t.name)" },
  feedback: { from: "feedback.submission t", label: "t.reference_code" },
  analytics: { from: "clinical_audit.analytics_access_event t", label: "t.surface || '.' || t.operation", time: "t.occurred_at" },
  photo: { from: "clinical.report_photo_note t", label: "null", time: "t.captured_at" },
  audio: { from: "clinical.report_audio_note t", label: "null", time: "t.captured_at" },
  note: { from: "clinical.report_note t", label: "null", time: "t.captured_at" },
};

type TargetRow = { target_id: string | null; target_kind: AuditTargetKind };
export async function resolveAuditTargets(manager: Pick<EntityManager, "query">, organizationId: string,
  page: readonly TargetRow[]): Promise<Map<string, AuditTarget>> {
  const idsByKind = new Map<AuditTargetKind, Set<string>>();
  for (const row of page) {
    if (!row.target_id || !lookups[row.target_kind]) continue;
    const valid = row.target_kind === "feedback" ? /^[0-9]{1,19}$/ : /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
    if (!valid.test(row.target_id)) continue;
    const ids = idsByKind.get(row.target_kind) ?? new Set<string>();
    ids.add(row.target_id); idsByKind.set(row.target_kind, ids);
  }
  const values: unknown[] = [organizationId];
  const queries = [...idsByKind].map(([kind, ids]) => {
    const lookup = lookups[kind]!;
    values.push([...ids]);
    return `select t.id::text id, '${kind}'::text kind, ${lookup.label}::text label,
      ${lookup.version ?? "null"}::integer version, ${lookup.time ?? "null"}::timestamptz occurred_at from ${lookup.from}
      where ${lookup.scope ?? "t.organization_id=$1"}
        and t.id=any($${values.length}::${kind === "feedback" ? "bigint" : "uuid"}[])`;
  });
  const rows = queries.length ? await manager.query<Array<AuditTarget & { id: string; occurred_at?: Date | string | null }>>(
    queries.join(" union all "), values) : [];
  return new Map(rows.map(({ id, occurred_at, ...target }) => [`${target.kind}:${id}`, {
    ...target, ...(occurred_at ? { occurredAt: new Date(occurred_at).toISOString() } : {}),
  }]));
}

export function auditResourceKind(action: string): AuditTargetKind {
  if (action.startsWith("analytics.")) return "analytics";
  if (action.startsWith("photo.")) return "photo";
  if (action.startsWith("audio.")) return "audio";
  if (action.startsWith("text.")) return "note";
  return "record";
}

// Called only with agency IDs from an already authorized event/page, including
// the agencies involved in historical cross-agency analytics. Never a directory search.
export async function resolveAuditOrganizations(manager: Pick<EntityManager, "query">,
  referencedIds: readonly string[]): Promise<Map<string, AuditOrganization>> {
  const ids = [...new Set(referencedIds)];
  const rows = ids.length ? await manager.query<AuditOrganization[]>(
    "select id, name from app_identity.organization where id=any($1::uuid[])", [ids]) : [];
  return new Map(rows.map(row => [row.id, row]));
}
