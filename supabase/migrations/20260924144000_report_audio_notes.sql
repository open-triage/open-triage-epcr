-- Canonical spoken-audio notes. Only verified mono AAC/M4A reaches these
-- tables; transient source recordings exist solely in process-owned temp files.
create table clinical.report_audio_note (
  id uuid primary key
    check (substring(id::text from 15 for 1) = '4'
      and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  captured_at timestamptz not null,
  captured_utc_offset_minutes smallint not null
    check (captured_utc_offset_minutes between -840 and 840),
  caption text
    check (caption is null or (
      char_length(caption) between 1 and 1000
      and caption = btrim(caption)
      and regexp_replace(caption, E'[\t\n\r]', '', 'g') !~ '[[:cntrl:]]'
    )),
  content_type text not null check (content_type = 'audio/mp4'),
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  duration_milliseconds integer not null
    check (duration_milliseconds between 1 and 300000),
  processing_state text not null default 'ready'
    check (processing_state = 'ready'),
  created_by uuid not null,
  updated_by uuid not null,
  server_received_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (report_id, id),
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id) on delete cascade,
  foreign key (organization_id, created_by)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, updated_by)
    references app_identity.app_user(organization_id, id)
);

create table clinical.report_audio_blob (
  organization_id uuid not null,
  report_id uuid not null,
  note_id uuid primary key,
  canonical_bytes bytea not null check (octet_length(canonical_bytes) > 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (report_id, note_id)
    references clinical.report_audio_note(report_id, id) on delete cascade,
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id) on delete cascade
);

create index report_audio_note_timeline_idx
on clinical.report_audio_note (report_id, captured_at desc, id desc);

create index report_audio_blob_report_idx
on clinical.report_audio_blob (report_id, note_id);

create index report_audio_note_organization_report_idx
on clinical.report_audio_note (organization_id, report_id);

create index report_audio_note_organization_created_by_idx
on clinical.report_audio_note (organization_id, created_by);

create index report_audio_note_organization_updated_by_idx
on clinical.report_audio_note (organization_id, updated_by);

create index report_audio_blob_organization_report_idx
on clinical.report_audio_blob (organization_id, report_id);

create function clinical.prevent_audio_blob_replacement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Saved audio bytes cannot be replaced';
end;
$$;

create trigger report_audio_blob_immutable
before update on clinical.report_audio_blob
for each row execute function clinical.prevent_audio_blob_replacement();

create trigger report_audio_note_signed_immutable
before insert or update or delete on clinical.report_audio_note
for each row execute function clinical.prevent_signed_report_mutation();

create trigger report_audio_blob_signed_immutable
before insert or delete on clinical.report_audio_blob
for each row execute function clinical.prevent_signed_report_mutation();

comment on table clinical.report_audio_blob is
  'Private canonical mono AAC/M4A bytes for spoken observations; never join into report list payloads.';

revoke all on table clinical.report_audio_note, clinical.report_audio_blob from public;
revoke execute on function clinical.prevent_audio_blob_replacement() from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on table clinical.report_audio_note, clinical.report_audio_blob from %I',
        api_role
      );
      execute format(
        'revoke execute on function clinical.prevent_audio_blob_replacement() from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

grant select, insert, delete on table clinical.report_audio_note to open_triage_api_runtime;
grant update (caption, updated_by, updated_at) on table clinical.report_audio_note
  to open_triage_api_runtime;
grant select, insert on table clinical.report_audio_blob to open_triage_api_runtime;
grant execute on function clinical.prevent_audio_blob_replacement() to open_triage_api_runtime;
