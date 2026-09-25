-- App-native notes are part of the legal report record, but remain outside
-- the standards-based NEMSIS encounter document. Archive them in a dedicated
-- envelope and verify every canonical media object while producing it.
create function retention.report_note_archive_payload(candidate_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  archive_notes jsonb;
begin
  if exists (
    select 1
    from clinical.report_photo_note note
    left join clinical.report_photo_blob blob
      on blob.organization_id = note.organization_id
     and blob.report_id = note.report_id and blob.note_id = note.id
    where note.report_id = candidate_report_id
      and (note.processing_state <> 'ready' or blob.note_id is null
        or octet_length(blob.canonical_bytes) <> note.byte_size
        or encode(public.digest(blob.canonical_bytes, 'sha256'), 'hex') <> note.sha256)
  ) or exists (
    select 1
    from clinical.report_audio_note note
    left join clinical.report_audio_blob blob
      on blob.organization_id = note.organization_id
     and blob.report_id = note.report_id and blob.note_id = note.id
    where note.report_id = candidate_report_id
      and (note.processing_state <> 'ready' or blob.note_id is null
        or octet_length(blob.canonical_bytes) <> note.byte_size
        or encode(public.digest(blob.canonical_bytes, 'sha256'), 'hex') <> note.sha256)
  ) then
    raise exception 'report % has incomplete or corrupt canonical note media', candidate_report_id;
  end if;

  select jsonb_build_object(
    'schemaVersion', 1,
    'text', coalesce((
      select jsonb_agg(to_jsonb(note) order by note.captured_at, note.id)
      from clinical.report_note note where note.report_id = candidate_report_id
    ), '[]'::jsonb),
    'photos', coalesce((
      select jsonb_agg(
        to_jsonb(note) || jsonb_build_object('canonicalMedia', jsonb_build_object(
          'encoding', 'base64',
          'bytes', replace(encode(blob.canonical_bytes, 'base64'), E'\n', ''),
          'byteSize', octet_length(blob.canonical_bytes),
          'sha256', encode(public.digest(blob.canonical_bytes, 'sha256'), 'hex')
        )) order by note.captured_at, note.id)
      from clinical.report_photo_note note
      join clinical.report_photo_blob blob
        on blob.organization_id = note.organization_id
       and blob.report_id = note.report_id and blob.note_id = note.id
      where note.report_id = candidate_report_id
    ), '[]'::jsonb),
    'audio', coalesce((
      select jsonb_agg(
        to_jsonb(note) || jsonb_build_object('canonicalMedia', jsonb_build_object(
          'encoding', 'base64',
          'bytes', replace(encode(blob.canonical_bytes, 'base64'), E'\n', ''),
          'byteSize', octet_length(blob.canonical_bytes),
          'sha256', encode(public.digest(blob.canonical_bytes, 'sha256'), 'hex')
        )) order by note.captured_at, note.id)
      from clinical.report_audio_note note
      join clinical.report_audio_blob blob
        on blob.organization_id = note.organization_id
       and blob.report_id = note.report_id and blob.note_id = note.id
      where note.report_id = candidate_report_id
    ), '[]'::jsonb)
  ) into archive_notes;
  return archive_notes;
end;
$$;

create or replace function retention.report_archive_payload(candidate_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, retention, clinical, clinical_audit, integration, analytics_private
as $$
  select jsonb_build_object(
    'archiveFormat', 'open-triage-report-archive-1.1.0',
    'report', to_jsonb(r),
    'incident', (select to_jsonb(i) from clinical.incident i where i.id = r.incident_id),
    'patient', (select to_jsonb(p) from clinical.patient p where p.id = r.patient_id),
    'contributors', coalesce((select jsonb_agg(to_jsonb(x) order by x.user_id, x.contribution_kind) from clinical.report_contributor x where x.report_id = r.id), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from clinical.group_instance x where x.report_id = r.id), '[]'::jsonb),
    'elements', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from clinical.element_occurrence x where x.report_id = r.id), '[]'::jsonb),
    'appNativeNotes', retention.report_note_archive_payload(r.id),
    'changes', coalesce((select jsonb_agg(to_jsonb(x) order by x.revision) from clinical.report_change x where x.report_id = r.id), '[]'::jsonb),
    'validationFindings', coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from clinical.validation_finding x where x.report_id = r.id), '[]'::jsonb),
    'signedSnapshot', (select to_jsonb(x) from clinical.signed_snapshot x where x.report_id = r.id),
    'amendments', coalesce((select jsonb_agg(to_jsonb(x) || jsonb_build_object('changes', coalesce((select jsonb_agg(to_jsonb(ac) order by ac.id) from clinical.amendment_change ac where ac.amendment_id = x.id), '[]'::jsonb)) order by x.sequence) from clinical.amendment x where x.report_id = r.id), '[]'::jsonb),
    'commandReceipts', coalesce((select jsonb_agg(to_jsonb(x) order by x.received_at, x.idempotency_key) from clinical.command_receipt x where x.report_id = r.id), '[]'::jsonb),
    'auditEvents', coalesce((select jsonb_agg(to_jsonb(x) order by x.report_sequence) from clinical_audit.event x where x.report_id = r.id), '[]'::jsonb),
    'outboxEvents', coalesce((select jsonb_agg(to_jsonb(x) order by x.occurred_at, x.id) from integration.outbox_event x where x.aggregate_type = 'report' and x.aggregate_id = r.id), '[]'::jsonb),
    'analyticsWide', coalesce((select jsonb_agg(to_jsonb(x) order by x.reporting_date) from analytics_private.epcr x where x.report_id = r.id), '[]'::jsonb),
    'analyticsRepeatable', coalesce((select jsonb_agg(to_jsonb(x) order by x.reporting_date, x.element_occurrence_id) from analytics_private.epcr_repeatable_element x where x.report_id = r.id), '[]'::jsonb)
  )
  from clinical.report r
  where r.id = candidate_report_id;
$$;

comment on function retention.report_note_archive_payload(uuid) is
  'Canonical app-native note archive, including verified media bytes, kept outside the NEMSIS encounter document.';

revoke all on function retention.report_note_archive_payload(uuid)
  from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on function retention.report_note_archive_payload(uuid) from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

grant execute on function retention.report_note_archive_payload(uuid)
  to open_triage_retention_executor;
