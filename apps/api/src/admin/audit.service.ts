import {HospitalHistoryService} from "../hospital/hospital-history.service.js";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { auditCategories, auditDumpSources, clinicalValueSources, patientAuditCategories, type AuditCategory, type AuditDump, type AuditEntry, type AuditPage, type AuditQuery, type AuditTargetKind, type AuditUserPage, type ClinicalAuditValues } from "@open-triage/contracts";
import { DataSource } from "typeorm";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { recordPatientAccess } from "../reports/patient-access-audit.js";
import { auditResourceKind, auditTargetKinds, resolveAuditOrganizations, resolveAuditTargets } from "./audit-targets.js";
import { auditEventIdColumn } from "./audit-event-ids.js";

// All SQL identifiers/expressions are maintained here, never supplied by a request.
// Deliberately omit payloads, notes, before/after values, session IDs and recovery handles.
function source(table: string, action: string, options: {
  // Every source must explicitly preserve a recorded result or describe the
  // evidence its rows prove. There is no blanket success/null default.
  outcome: string;
  time?: string; actor?: string; target?: string; targetKind?: string; organization?: string;
  join?: string; patient?: string; accessOrganization?: string; careProcess?: string; resource?: string; analytics?: string;
  targetLabel?: string; inspection?: string; recovery?: string; integration?: string;
  // Additional metadata UUIDs only: never index identifiers from protected payloads.
  searchIds?: string;
}): string {
  return `select '${table}'::text source, e.${auditEventIdColumn(table)}::text event_id,
    ${options.time ?? "e.occurred_at"} occurred_at, ${options.actor ?? "e.actor_id"}::text actor_id,
    ${action}::text action, ${options.target ?? "null"}::text target_id,
    ${options.targetKind ?? `'${auditTargetKinds[table] ?? "record"}'`}::text target_kind,
    ${options.targetLabel ?? "null"}::text target_label,
    ${options.outcome}::text outcome, ${options.patient ?? "null"}::uuid patient_id,
    ${options.accessOrganization ?? "null"}::uuid access_organization_id,
    ${options.careProcess ?? "null"}::text care_process,
    ${options.resource ?? "null"}::uuid resource_id, ${options.analytics ?? "null"}::jsonb analytics,
    ${options.inspection ?? "null"}::jsonb inspection,
    ${options.recovery ?? "null"}::jsonb recovery,
    ${options.integration ?? "null"}::jsonb integration,
    ${options.searchIds ?? "'{}'::uuid[]"}::uuid[] search_ids
    from ${table} e ${options.join ?? ""}
    where ${options.organization ?? "e.organization_id"} = $1`;
}

export const auditSources: Record<AuditCategory, string[]> = {
  patient: [source("clinical_audit.patient_access_event", "e.action", { target: "e.report_id",
    patient: "e.patient_id", accessOrganization: "e.access_organization_id", careProcess: "e.care_process",
    resource: "e.resource_id", outcome: "'authorized'", integration:"case when e.action like 'eps.%' then jsonb_build_object('destination','eps','reportId',e.report_id,'dataset',case when e.synthetic then 'synthetic' else 'real' end,'configurationRevision',e.integration_provenance->'configurationRevision','mappingId',e.integration_provenance->'mappingId','mappingRevision',e.integration_provenance->'mappingRevision','mappingSha256',e.integration_provenance->'mappingSha256') end" })],
  analytics: [source("clinical_audit.analytics_access_event", "e.surface || '.' || e.operation", { target: "e.id", outcome: "'prepared'",
    searchIds: "e.scoped_organization_ids",
    analytics: "jsonb_build_object('dataset',e.dataset,'from',e.from_date,'through',e.through_date,'reportCount',e.report_count,'reportScope',e.report_scope,'identifying',e.identifying,'organizationIds',e.scoped_organization_ids)" })],
  authentication: [source("app_identity.authentication_event", "e.action", { target: "e.target_user_id", outcome: "e.result" }),
    source("app_identity.operator_identity_event", "e.command", { organization: "e.target_organization_id", actor: "null", target: "e.target_user_id", outcome: "e.result" })],
  authorization: [source("app_identity.authorization_event", "e.action", { target: "e.target_key", outcome: "'succeeded'",
    targetKind: "case e.target_type when 'role' then 'role' when 'role_version' then 'roleVersion' when 'role_package' then 'rolePackage' when 'capability' then 'capability' else 'record' end" }),
    source("app_identity.ownership_transfer_event", "e.action", { target: "e.transfer_id", outcome: "e.result" }),
    source("app_identity.organization_event", "e.action", { target: "e.organization_id", outcome: "'succeeded'" })],
  configuration: [source("app_identity.configuration_event", "e.action", { target: "e.form_version_id", outcome: "e.result", integration:"case when e.action like 'hospital.%' then jsonb_build_object('destination',e.details->>'integration','configurationRevision',e.details->'revision','mappingId',e.details->'mappingId','mappingSha256',e.content_sha256) end" }),
    source("catalog.publication_event", "'catalog.publish'", { target: "e.release_id", outcome: "e.result" }),
    source("validation.change_event", "e.action", { target: "e.destination_version_id", outcome: "'succeeded'" }),
    source("app_identity.agency_settings_change_event", "'settings.change'", { target: "e.organization_id", outcome: "'succeeded'" }),
    source("app_identity.agency_demographic_change_event", "'demographics.change'", { target: "e.version_id", outcome: "'succeeded'" })],
  clinical: [source("clinical_audit.hospital_operational_event", "e.action", {time:"e.occurred_at",target:"e.report_id",targetKind:"'record'",outcome:"e.state",integration:"jsonb_build_object('destination',e.integration,'verification',e.verification,'reportId',e.report_id,'snapshotId',e.snapshot_id,'amendmentSequence',e.amendment_sequence,'payloadSha256',e.payload_sha256,'dataset',case when e.synthetic then 'synthetic' else 'real' end,'configurationRevision',e.configuration_revision,'mappingId',e.mapping_id,'mappingRevision',e.mapping_revision,'mappingSha256',e.mapping_sha256,'attemptId',e.attempt_id,'commandId',e.command_id,'finding',e.finding,'receiptId',e.receipt_id,'proofOutcome',e.proof_outcome,'proofFenced',e.proof_fenced,'remotePass',e.remote_pass,'remoteErrors',e.remote_errors)",searchIds:"array[e.source_id,e.snapshot_id,e.attempt_id,e.command_id]"}),source("clinical.eps_submission_attempt", "'eps.submit'", {time:"e.created_at",target:"s.report_id",targetKind:"'record'",outcome:"coalesce(result.state,'unknown')",join:"join clinical.eps_submission s on s.id=e.submission_id join clinical.report r on r.id=s.report_id left join clinical.eps_submission_result result on result.attempt_id=e.id",organization:"s.organization_id",integration:"jsonb_build_object('destination','eps','reportId',s.report_id,'dataset',case when r.synthetic then 'synthetic' else 'real' end,'configurationRevision',s.configuration_revision,'mappingId',s.mapping_id,'mappingRevision',s.mapping_revision,'mappingSha256',s.mapping_sha256)",searchIds:"array[s.id,s.snapshot_id]"}),source("clinical_audit.event", "e.action", { time: "e.server_time", target: "e.report_id",
    // This ledger has an open-ended action field. Only the two known writers
    // establish success; unfamiliar historical actions remain unspecified.
    outcome: "case when e.action in ('sign','amend') then 'succeeded' end",
    join: "join clinical.report r on r.id=e.report_id", organization: "r.organization_id" }),
    source("clinical.report_change", "'report.draft_save'", { time: "e.server_received_time", actor: "e.author_id", target: "e.report_id",
      // The command was accepted; individual losing edits may be reconciled.
      outcome: "'accepted'",
      join: "join clinical.report r on r.id=e.report_id", organization: "r.organization_id" }),
    source("clinical_audit.draft_reconciliation", "'report.conflict_resolution'", { time: "e.created_at", actor: "e.winning_author_id", target: "e.report_id",
      outcome: "'reconciled'",
      join: "join clinical.report r on r.id=e.report_id", organization: "r.organization_id" }),
    source("clinical_audit.report_note_mutation_event", "e.note_type || '.' || e.action", { target: "e.report_id", resource: "e.note_id", outcome: "e.result" }),
    source("clinical_audit.post_signature_audit_note", "'report.post_signature_attempt'", { time: "e.created_at", actor: "e.author_id", target: "e.report_id",
      outcome: "'not-applied'",
      join: "join clinical.report r on r.id=e.report_id", organization: "r.organization_id" })],
  media: [source("clinical_audit.report_media_access_event", "e.media_type || '.' || e.action", { target: "e.report_id", resource: "e.note_id", outcome: "e.result" })],
  recovery: [source("offline_recovery.event", "e.event_type", { actor: "null", target: "e.report_id",
    outcome: `case e.event_type when 'ciphertext_written' then 'recorded'
      when 'recovery_succeeded' then 'succeeded' when 'recovery_unavailable' then 'unavailable'
      when 'key_expired' then 'expired' when 'policy_shortened' then 'applied' end` }),
    source("offline_recovery.key_lifecycle_event", "e.event_type", { actor: "e.actor_user_id", target: "e.report_id", outcome: "e.outcome" }),
    source("offline_recovery.report_recovery_event", "e.action", { actor: "e.user_id", target: "e.report_id", outcome: "e.outcome" })],
  review: [source("clinical.cos_recovery_command", "case when e.automatic_ordinal is null then 'cos.manual-retry' else 'cos.automatic-retry' end", {time:"e.created_at",target:"e.item_id",outcome:"'queued'",
    join:"join clinical.report r on r.id=e.report_id",organization:"r.organization_id",
    recovery:"jsonb_build_object('reportId',e.report_id,'itemId',e.item_id,'dataset',case when r.synthetic then 'synthetic' else 'real' end,'amendmentSequence',e.amendment_sequence)"}),
    source("clinical.cos_delivery_event", "'cos.delivery'", {time:"e.created_at",actor:"coalesce(e.actor_id,c.actor_id)",target:"i.id",outcome:"e.state",integration:"jsonb_build_object('destination','cos','reportId',d.report_id,'dataset',case when r.synthetic then 'synthetic' else 'real' end,'configurationRevision',d.configuration_revision,'mappingId',d.mapping_id,'mappingRevision',d.mapping_revision,'mappingSha256',d.mapping_sha256)",
      searchIds:"array[d.id,d.snapshot_id,e.attempt_id]",join:"join clinical.report r on r.id=e.report_id join clinical.cos_delivery d on d.id=e.delivery_id join clinical.review_item i on i.report_id=r.id and i.kind='cos-delivery-failed' left join clinical.cos_attempt a on a.id=e.attempt_id left join clinical.cos_recovery_command c on c.id=a.recovery_command_id",organization:"r.organization_id",
      recovery:"jsonb_build_object('reportId',e.report_id,'itemId',i.id,'dataset',case when r.synthetic then 'synthetic' else 'real' end,'amendmentSequence',d.amendment_sequence)"}),source("clinical.review_assignment_history", "e.action", { time: "e.assigned_at", target: "e.item_id",
    outcome: "case when e.assignee_id is null then 'unassigned' else 'assigned' end" }),
    source("clinical.review_overdue_history", "e.action", { time: "e.recorded_at", target: "e.item_id",
      outcome: `case e.action when 'detected' then 'opened' when 'resolved-by-signing' then 'resolved'
        when 'closed-exceptionally' then 'closed' when 'signed-after-exception' then 'reconciled' end` }),
    source("clinical.review_progress_history", "'review.progress'", { time: "e.recorded_at", target: "e.item_id", outcome: "e.status" }),
    source("clinical.review_saved_analysis_history", "e.action", { time: "e.recorded_at", target: "e.analysis_id", outcome: "'succeeded'" }),
    source("clinical.review_criterion_route_history", "'review.route'", { time: "e.recorded_at", target: "e.criterion_id",
      outcome: "case when e.reason='ineligible' then 'unassigned' else 'succeeded' end" }),
    source("clinical.review_amendment_policy_history", "'review.amendment_policy'", { time: "e.recorded_at", target: "e.organization_id", outcome: "'succeeded'" }),
    source("clinical.review_overdue_policy_history", "'review.overdue_policy'", { time: "e.recorded_at", target: "e.organization_id", outcome: "'succeeded'" })],
  synthetic: [source("clinical_audit.synthetic_generation_event", "e.action", { target: "e.assignment_id", outcome: "'succeeded'" }),
    source("clinical_audit.synthetic_draft_mutation_event", "e.action", { target: "e.report_id", outcome: "'succeeded'" })],
  // These ledgers are written in the same transaction as successful changes.
  // Rejected attempts roll back without an event; historical rows therefore
  // prove success regardless of the installation or unit's current state.
  installations: [source("app_identity.installation_event", "e.event_type", { target: "e.installation_id", outcome: "'succeeded'" }),
    source("app_identity.operational_unit_event", "'unit.change'", { target: "e.unit_id", outcome: "'succeeded'" })],
  feedback: [source("feedback.submission", "'feedback.submit.' || e.submission_type", {
    time: "e.created_at", target: "e.id", outcome: "'accepted'" }),
    source("feedback.review_event", "'feedback.review'", { time: "e.reviewed_at", actor: "e.human_reviewer_id", target: "e.submission_id",
      outcome: "e.review_status", join: "join feedback.submission s on s.id=e.submission_id", organization: "s.organization_id" })],
  audit: [source("clinical_audit.audit_read_event", "'audit.' || e.category || '.' || e.inspection_kind", {
    target: "coalesce(e.inspected_event_uuid::text,e.target_filter::text)", outcome: "'inspected'",
    targetKind: "case when e.inspected_event_uuid is not null then 'auditEvent' when e.inspection_kind='clinical-values' then 'report' else 'record' end",
    targetLabel: "e.inspected_source || ':' || e.inspected_event_uuid::text",
    inspection: "jsonb_build_object('kind',e.inspection_kind,'category',e.category,'categories',e.queried_categories,'uuidFilter',e.uuid_filter)",
    searchIds: "array[e.actor_filter,e.target_filter,e.uuid_filter]",
  })],
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestamp.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
type Cursor = { time: string; source: string; id: string; snapshot?: string };
export function validateAuditQuery(input: Record<string, unknown>): AuditQuery & { categories: AuditCategory[]; after?: Cursor } {
  const invalid = () => { throw new BadRequestException({ code: "audit.invalidQuery" }); };
  if (Object.keys(input).some((key) => !["category", "categories", "from", "to", "actorId", "targetId", "uuid", "cursor"].includes(key))) invalid();
  if (input.targetId !== undefined && input.uuid !== undefined) invalid();
  if (input.category !== undefined && (!auditCategories.includes(input.category as AuditCategory) || input.categories !== undefined)) invalid();
  if (input.categories !== undefined && (typeof input.categories !== "string" || input.categories.length > 256)) invalid();
  const requested = input.category !== undefined ? [input.category as string]
    : input.categories ? (input.categories as string).split(",") : [];
  if (requested.some(category => !auditCategories.includes(category as AuditCategory))) invalid();
  const categories = auditCategories.filter(category => requested.includes(category));
  for (const field of ["from", "to"]) if (!validTimestamp(input[field])) invalid();
  const span = Date.parse(String(input.to)) - Date.parse(String(input.from));
  if (span <= 0 || span > 31 * 86400_000) invalid();
  for (const field of ["actorId", "targetId", "uuid"]) if (input[field] !== undefined && (typeof input[field] !== "string" || !uuid.test(input[field] as string))) invalid();
  let after: Cursor | undefined;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== "string" || input.cursor.length > 512 || !/^[\w-]+$/.test(input.cursor)) invalid();
    try {
      const decoded = JSON.parse(Buffer.from(input.cursor as string, "base64url").toString("utf8"));
      if (!decoded || !validTimestamp(decoded.time) ||
        typeof decoded.source !== "string" || !/^[a-z_]+\.[a-z_]+$/.test(decoded.source) ||
        typeof decoded.id !== "string" || !uuid.test(decoded.id) ||
        (decoded.snapshot !== undefined && !validTimestamp(decoded.snapshot))) invalid();
      after = decoded;
    } catch { invalid(); }
  }
  return { ...input as AuditQuery, categories, actorId: (input.actorId as string | undefined)?.toLowerCase(),
    targetId: (input.targetId as string | undefined)?.toLowerCase(), uuid: (input.uuid as string | undefined)?.toLowerCase(), after };
}

@Injectable()
export class AuditService {
  constructor(@InjectDataSource() private readonly database: DataSource, private readonly sessions: ClinicianSessionService) {}

  async users(token: string, input: Record<string, unknown>): Promise<AuditUserPage> {
    const invalid = () => { throw new BadRequestException({ code: "audit.invalidQuery" }); };
    if (Object.keys(input).some((key) => key !== "cursor")) invalid();
    let after: { name: string; id: string } | undefined;
    if (input.cursor !== undefined) {
      if (typeof input.cursor !== "string" || input.cursor.length > 2048 || !/^[\w-]+$/.test(input.cursor)) invalid();
      try {
        const decoded = JSON.parse(Buffer.from(input.cursor as string, "base64url").toString("utf8"));
        if (!decoded || typeof decoded.name !== "string" || decoded.name.length > 200 ||
          typeof decoded.id !== "string" || !uuid.test(decoded.id)) invalid();
        after = decoded;
      } catch { invalid(); }
    }
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "audit:read", manager);
      // Audit-only roles need names, not access to the administrative user directory.
      // Include disabled members so historical activity remains filterable.
      const rows = await manager.query<Array<{ id: string; display_name: string }>>(`
        select id, display_name from app_identity.agency_user
        where organization_id=$1
          and ($2::text is null or (display_name, id) > ($2::text, $3::uuid))
        order by display_name, id limit 101
      `, [session.organization.id, after?.name ?? null, after?.id ?? null]);
      const page = rows.slice(0, 100), last = page.at(-1);
      return { users: page.map((row) => ({ id: row.id, displayName: row.display_name })),
        nextCursor: rows.length > 100 && last ? Buffer.from(JSON.stringify({ name: last.display_name, id: last.id })).toString("base64url") : null };
    });
  }

  async list(token: string, input: Record<string, unknown>): Promise<AuditPage> {
    const query = validateAuditQuery(input);
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "audit:read", manager);
      const patientAccess = !session.installationOwner && !session.installationSuperadmin &&
        session.capabilities?.includes("audit:identifying");
      const categories = auditCategories.filter((category) => patientAccess || !patientAuditCategories.includes(category));
      if (query.categories.some(category => !categories.includes(category))) throw new ForbiddenException({ code: "audit.patientAccessRequired" });
      const selectedCategories = query.categories.length ? query.categories : categories;
      await manager.query("select set_config('open_triage.audit_organization_id', $1, true)", [session.organization.id]);
      type Row = { category: AuditCategory; source: string; event_id: string; occurred_at: Date | string; cursor_time: string;
        actor_id: string | null; action: string; target_id: string | null; target_kind: AuditTargetKind; target_label: string | null; outcome: string | null;
        patient_id: string | null; access_organization_id: string | null; care_process: string | null;
        resource_id: string | null; analytics: AuditEntry["analytics"]; inspection: AuditEntry["inspection"]; recovery: AuditEntry["recovery"]; integration:AuditEntry["integration"] };
      // Counts and rows share every scope/filter predicate. Retain the first page's
      // upper time bound so subsequent inspection events do not move the page total.
      const snapshot = "least($3::timestamptz, coalesce($10::timestamptz, statement_timestamp()), statement_timestamp())";
      const filtered = `from (${selectedCategories.map(category =>
          `select '${category}'::text category, category_events.* from (${auditSources[category].join(" union all ")}) category_events`
        ).join(" union all ")}) events
        where occurred_at >= $2::timestamptz and occurred_at < ${snapshot}
          and ($4::text is null or actor_id=$4)
          and ($5::text is null or target_id=$5 or patient_id::text=$5 or resource_id::text=$5)
          and ($9::text is null or event_id=$9 or actor_id=$9 or target_id=$9
            or patient_id=$9::uuid or resource_id=$9::uuid or access_organization_id=$9::uuid
            or $1::uuid=$9::uuid or $9::uuid=any(search_ids))`;
      const parameters = [session.organization.id, query.from, query.to, query.actorId ?? null, query.targetId ?? null,
        query.after?.time ?? null, query.after?.source ?? null, query.after?.id ?? null, query.uuid ?? null, query.after?.snapshot ?? null];
      const [counts] = await manager.query<Array<{ total_count: string; skipped_count: string; snapshot_time: string }>>(`
        select count(*)::text total_count,
          count(*) filter (where $6::timestamptz is not null and
            (occurred_at, source, event_id) >= ($6::timestamptz, $7::text, $8::text))::text skipped_count,
          to_char(${snapshot} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') snapshot_time
        ${filtered}
      `, parameters);
      parameters[9] = counts!.snapshot_time;
      const totalEntries = Number(counts!.total_count), totalPages = Math.ceil(totalEntries / 50);
      const pageNumber = totalEntries ? Math.min(totalPages, Math.floor(Number(counts!.skipped_count) / 50) + 1) : 0;
      const rows = await manager.query<Row[]>(`
        select *, to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time
        ${filtered}
          and ($6::timestamptz is null or (occurred_at, source, event_id) < ($6::timestamptz, $7::text, $8::text))
        order by occurred_at desc, source desc, event_id desc limit 51
      `, parameters);
      const page = rows.slice(0, 50);
      // Resolve only actors in this authorized page. Retained events can outlive
      // accounts, and some sources use operator labels rather than account UUIDs.
      const actorIds = [...new Set(page.map((row) => row.actor_id)
        .filter((id): id is string => id !== null && uuid.test(id)))];
      const actors = actorIds.length ? await manager.query<Array<{ id: string; username: string | null; display_name: string }>>(`
        select u.id, u.display_name, coalesce(credential.username,
          (select linked.username_hint from app_identity.regional_identity_request linked
            where linked.linked_user_id=u.id and linked.username_hint is not null
            order by linked.linked_at desc, linked.id limit 1)) username
        from app_identity.app_user u
        left join app_identity.local_credential credential on credential.user_id=u.id
        where u.id = any($1::uuid[])
      `, [actorIds]) : [];
      const actorById = new Map(actors.map((actor) => [actor.id, actor]));
      const targets = await resolveAuditTargets(manager, session.organization.id, [...page,
        ...page.filter(row => row.resource_id).map(row => ({ target_id: row.resource_id, target_kind: auditResourceKind(row.action) })),
      ]);
      const organizations = await resolveAuditOrganizations(manager, page.flatMap(row => [
        ...(row.access_organization_id ? [row.access_organization_id] : []), ...(row.analytics?.organizationIds ?? []),
      ]));
      await manager.query(`insert into clinical_audit.audit_read_event
        (organization_id, actor_id, category, from_time, to_time, actor_filter, target_filter, returned_count, queried_categories, uuid_filter)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [session.organization.id, session.user.id,
        selectedCategories.length === 1 ? selectedCategories[0] : "combined",
        query.from, query.to, query.actorId ?? null, query.targetId ?? null, page.length, selectedCategories, query.uuid ?? null]);
      const last = page.at(-1);
      const entries: AuditEntry[] = page.map((row) => ({ id: row.event_id, category: row.category, source: row.source,
        occurredAt: new Date(row.occurred_at).toISOString(), actorId: row.actor_id,
        actorUsername: actorById.get(row.actor_id ?? "")?.username ?? null,
        actorDisplayName: actorById.get(row.actor_id ?? "")?.display_name ?? null,
        action: row.action, targetId: row.target_id, outcome: row.outcome, patientId: row.patient_id,
        target: row.target_id ? (row.target_label ? { kind: row.target_kind, label: row.target_label } : targets.get(`${row.target_kind}:${row.target_id}`)) ?? {
          kind: row.target_kind, label: row.target_kind === "capability" ? row.target_id : null,
        } : null,
        accessOrganizationId: row.access_organization_id, careProcess: row.care_process,
        accessOrganizationName: organizations.get(row.access_organization_id ?? "")?.name ?? null,
        resourceId: row.resource_id,
        inspection: row.inspection,
        ...(row.recovery ? {recovery:row.recovery} : {}),
        ...(row.integration ? {integration:row.integration} : {}),
        resource: row.resource_id ? targets.get(`${auditResourceKind(row.action)}:${row.resource_id}`) ?? {
          kind: auditResourceKind(row.action), label: null,
        } : null,
        analytics: row.analytics ? { ...row.analytics, organizations: row.analytics.organizationIds.map(id =>
          organizations.get(id) ?? { id, name: null }) } : null }));
      const history=new HospitalHistoryService(this.database,this.sessions);
      for(const entry of entries)if(entry.recovery&&!await history.reviewLink(manager,session,entry.recovery.reportId,entry.recovery.dataset))delete entry.recovery;
      return { entries, categories, pageNumber, totalPages, totalEntries,
        nextCursor: rows.length > 50 && last ? Buffer.from(JSON.stringify({
          time: last.cursor_time, source: last.source, id: last.event_id, snapshot: counts!.snapshot_time })).toString("base64url") : null };
    });
  }

  async payload(token: string, sourceName: string, eventId: string): Promise<AuditDump> {
    const analytics = sourceName === "clinical_audit.analytics_access_event";
    if (!auditDumpSources.includes(sourceName as typeof auditDumpSources[number]) ||
      !uuid.test(eventId))
      throw new BadRequestException({ code: "audit.invalidQuery" });
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "audit:read", manager);
      if (analytics && (session.installationOwner || session.installationSuperadmin || !session.capabilities?.includes("audit:identifying")))
        throw new ForbiddenException({ code: "audit.patientAccessRequired" });
      await manager.query("select set_config('open_triage.audit_organization_id', $1, true)", [session.organization.id]);
      let result: AuditDump;
      if (analytics) {
        const [row] = await manager.query<Array<{ payload: AuditDump["payload"]; captured: boolean; organization_ids: string[] }>>(`
          select scoped_organization_ids organization_ids, query_payload is not null captured, jsonb_build_object(
            'eventId',id,'occurredAt',occurred_at,'surface',surface,'operation',operation,
            'request',query_payload,'execution',jsonb_build_object('dataset',dataset,'from',from_date,
              'through',through_date,'reportScope',report_scope,'identifying',identifying,
              'organizationIds',scoped_organization_ids,'reportCount',report_count)) payload
          from clinical_audit.analytics_access_event where organization_id=$1 and id=$2::uuid`,
        [session.organization.id,eventId]);
        if (!row) throw new NotFoundException();
        const organizations = await resolveAuditOrganizations(manager, row.organization_ids);
        row.payload.execution = { ...row.payload.execution as Record<string, unknown>,
          organizations: row.organization_ids.map(id => organizations.get(id) ?? { id, name: null }) };
        result = { kind: "analytics", payload: row.payload, requestCaptured: row.captured };
      } else {
        const review = sourceName === "feedback.review_event";
        const [row] = await manager.query<Array<{ payload: AuditDump["payload"] }>>(`
          select jsonb_build_object('submission',jsonb_build_object(
            'id',s.audit_id::text,'referenceCode',s.reference_code,'type',s.submission_type,
            'description',s.original_description,'createdAt',s.created_at,
            'submittedBy',jsonb_build_object('id',s.actor_id,'displayName',s.actor_display_name),
            'organization',jsonb_build_object('id',s.organization_id,'name',s.organization_display_name)),
            'diagnostics',jsonb_build_object('status',coalesce(d.diagnostic_status,'not-retained'),
              'schemaVersion',d.schema_version,'unavailableReason',d.unavailable_reason,'payload',d.payload),
            'review',${review ? `jsonb_build_object('id',r.audit_id::text,'version',r.review_version,
              'status',r.review_status,'priority',r.review_priority,'summary',r.approved_summary,
              'note',r.review_note,'reviewerType',r.reviewer_type,'reviewerId',r.human_reviewer_id,
              'reviewerDisplayName',(select u.display_name from app_identity.app_user u
                where u.id=case when r.human_reviewer_id ~* '${uuid.source}' then r.human_reviewer_id::uuid end),
              'modelIdentifier',r.model_identifier,'reviewRunId',r.review_run_id,'reviewedAt',r.reviewed_at)` : "null"}) payload
          from feedback.submission s ${review ? "join feedback.review_event r on r.submission_id=s.id" : ""}
          left join feedback.diagnostic d on d.submission_id=s.id
          where s.organization_id=$1 and ${review ? "r" : "s"}.audit_id=$2::uuid`, [session.organization.id,eventId]);
        if (!row) throw new NotFoundException();
        result = { kind: "feedback", payload: row.payload };
      }
      // Fail closed: no payload is returned unless its inspection is durably recorded.
      await manager.query(`insert into clinical_audit.audit_read_event
        (organization_id,actor_id,category,from_time,to_time,target_filter,returned_count,inspection_kind,inspected_source,inspected_event_id,inspected_event_uuid)
        values($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '1 second',$4,1,'payload',$5,$6::text,$6::uuid)`,
      [session.organization.id,session.user.id,analytics ? "analytics" : "feedback",analytics ? eventId : null,sourceName,eventId.toLowerCase()]);
      return result;
    });
  }

  async clinicalValues(token: string, sourceName: string, eventId: string): Promise<ClinicalAuditValues> {
    if (!clinicalValueSources.includes(sourceName as typeof clinicalValueSources[number]) || !uuid.test(eventId))
      throw new BadRequestException({ code: "audit.invalidQuery" });
    const projections: Record<typeof clinicalValueSources[number], string> = {
      "clinical_audit.event": "jsonb_build_object('priorValue',e.prior_value,'newValue',e.new_value)",
      "clinical.report_change": "jsonb_build_object('submittedChanges',e.changes - 'baseRevision')",
      "clinical_audit.draft_reconciliation": "jsonb_build_object('discardedChange',e.losing_value)",
      "clinical_audit.post_signature_audit_note": "jsonb_build_object('attemptedChange',e.attempted_change)",
    };
    return this.database.transaction("REPEATABLE READ", async (manager) => {
      const session = await this.sessions.requireCapability(token, "audit:identifying", manager);
      if (session.installationOwner || session.installationSuperadmin || !session.capabilities?.includes("audit:read"))
        throw new ForbiddenException({ code: "audit.patientAccessRequired" });
      const [row] = await manager.query<Array<{ report_id: string; values: ClinicalAuditValues["values"] }>>(`
        select e.report_id, ${projections[sourceName as typeof clinicalValueSources[number]]} as values
        from ${sourceName} e join clinical.report r on r.id=e.report_id
        where r.organization_id=$1 and e.${auditEventIdColumn(sourceName)}=$2::uuid`, [session.organization.id, eventId.toLowerCase()]);
      if (!row) throw new NotFoundException();
      await recordPatientAccess(manager, { organizationId: session.organization.id, actorId: session.user.id,
        reportIds: [row.report_id], action: "audit.clinical-values", careProcess: "audit" });
      await manager.query(`insert into clinical_audit.audit_read_event
        (organization_id,actor_id,category,from_time,to_time,target_filter,returned_count,inspection_kind,inspected_source,inspected_event_id,inspected_event_uuid)
        values($1,$2,'clinical',clock_timestamp(),clock_timestamp()+interval '1 second',$3,1,'clinical-values',$4,$5::text,$5::uuid)`,
      [session.organization.id, session.user.id, row.report_id, sourceName, eventId.toLowerCase()]);
      return { values: row.values };
    });
  }
}
