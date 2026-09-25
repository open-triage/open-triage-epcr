-- Stable note-target lineage permits ordinary report reconciliation without
-- retaining clinical text or captions in conflict/audit metadata.
create table clinical.report_note_target_state (
  report_id uuid not null references clinical.report(id) on delete cascade,
  note_type text not null check (note_type in ('text', 'photo', 'audio')),
  note_id uuid not null,
  revision bigint not null check (revision > 0),
  command_id uuid not null,
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('create', 'update', 'delete')),
  server_received_at timestamptz not null default clock_timestamp(),
  primary key (report_id, note_type, note_id),
  foreign key (report_id, revision)
    references clinical.report_change(report_id, revision),
  foreign key (report_id, command_id)
    references clinical.report_change(report_id, idempotency_key)
);

comment on table clinical.report_note_target_state is
  'Content-free winning command lineage and deletion tombstones for stable report note identities.';

create table clinical_audit.report_note_mutation_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null references clinical.report(id) on delete cascade,
  note_id uuid not null,
  note_type text not null check (note_type in ('text', 'photo', 'audio')),
  command_id uuid not null,
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('create', 'update', 'delete')),
  result text not null check (result in ('applied', 'reconciled', 'idempotent')),
  report_revision bigint not null check (report_revision >= 0),
  occurred_at timestamptz not null default clock_timestamp()
);

create index report_note_mutation_event_report_idx
on clinical_audit.report_note_mutation_event (report_id, occurred_at desc, id desc);

create table clinical_audit.report_media_access_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null references clinical.report(id) on delete cascade,
  note_id uuid not null,
  media_type text not null check (media_type in ('photo', 'audio')),
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('open', 'retrieve')),
  result text not null check (result = 'allowed'),
  occurred_at timestamptz not null default clock_timestamp()
);

create index report_media_access_event_report_idx
on clinical_audit.report_media_access_event (report_id, occurred_at desc, id desc);

create trigger report_note_mutation_event_append_only
before update or delete on clinical_audit.report_note_mutation_event
for each row execute function public.prevent_update_or_delete();

create trigger report_media_access_event_append_only
before update or delete on clinical_audit.report_media_access_event
for each row execute function public.prevent_update_or_delete();

-- Capture provenance is immutable even to privileged application SQL. Only
-- clinical text/captions and their edit attribution may change while draft.
create function clinical.prevent_report_note_provenance_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.report_id is distinct from old.report_id
     or new.captured_at is distinct from old.captured_at
     or new.captured_utc_offset_minutes is distinct from old.captured_utc_offset_minutes
     or new.created_by is distinct from old.created_by
     or new.server_received_at is distinct from old.server_received_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Report note capture provenance is immutable';
  end if;
  return new;
end;
$$;

create trigger report_text_note_provenance_immutable
before update on clinical.report_note
for each row execute function clinical.prevent_report_note_provenance_change();
create trigger report_photo_note_provenance_immutable
before update on clinical.report_photo_note
for each row execute function clinical.prevent_report_note_provenance_change();
create trigger report_audio_note_provenance_immutable
before update on clinical.report_audio_note
for each row execute function clinical.prevent_report_note_provenance_change();

revoke all on table clinical.report_note_target_state,
  clinical_audit.report_note_mutation_event,
  clinical_audit.report_media_access_event from public;
revoke execute on function clinical.prevent_report_note_provenance_change()
  from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on table clinical.report_note_target_state, clinical_audit.report_note_mutation_event, clinical_audit.report_media_access_event from %I',
        api_role
      );
      execute format(
        'revoke execute on function clinical.prevent_report_note_provenance_change() from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

grant select, insert, update, delete on table clinical.report_note_target_state
  to open_triage_api_runtime;
grant insert on table clinical_audit.report_note_mutation_event,
  clinical_audit.report_media_access_event to open_triage_api_runtime;
grant select on table clinical_audit.report_note_mutation_event,
  clinical_audit.report_media_access_event to open_triage_auditor;

revoke update on table clinical.report_note from open_triage_api_runtime;
grant update (content, updated_by, updated_at) on table clinical.report_note
  to open_triage_api_runtime;

grant execute on function clinical.prevent_report_note_provenance_change()
  to open_triage_api_runtime;
