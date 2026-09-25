-- Canonical online photo notes. Metadata is listable, while the protected
-- bytes live in a distinct table that ordinary report queries never touch.
create table clinical.report_photo_note (
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
      and regexp_replace(caption, E'[\\t\\n\\r]', '', 'g') !~ '[[:cntrl:]]'
    )),
  content_type text not null check (content_type = 'image/jpeg'),
  byte_size bigint not null check (byte_size > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width between 1 and 2560),
  height integer not null check (height between 1 and 2560),
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

create table clinical.report_photo_blob (
  organization_id uuid not null,
  report_id uuid not null,
  note_id uuid primary key,
  canonical_bytes bytea not null check (octet_length(canonical_bytes) > 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (report_id, note_id)
    references clinical.report_photo_note(report_id, id) on delete cascade,
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id) on delete cascade
);

create index report_photo_note_timeline_idx
on clinical.report_photo_note (report_id, captured_at desc, id desc);

create index report_photo_blob_report_idx
on clinical.report_photo_blob (report_id, note_id);

create function clinical.prevent_photo_blob_replacement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Saved photo bytes cannot be replaced';
end;
$$;

create trigger report_photo_blob_immutable
before update on clinical.report_photo_blob
for each row execute function clinical.prevent_photo_blob_replacement();

create trigger report_photo_note_signed_immutable
before insert or update or delete on clinical.report_photo_note
for each row execute function clinical.prevent_signed_report_mutation();

create trigger report_photo_blob_signed_immutable
before insert or delete on clinical.report_photo_blob
for each row execute function clinical.prevent_signed_report_mutation();

comment on table clinical.report_photo_blob is
  'Private, separately fetched canonical photo bytes; never join into report list payloads.';

revoke all on table clinical.report_photo_note, clinical.report_photo_blob from public;
revoke execute on function clinical.prevent_photo_blob_replacement() from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on table clinical.report_photo_note, clinical.report_photo_blob from %I',
        api_role
      );
      execute format(
        'revoke execute on function clinical.prevent_photo_blob_replacement() from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

grant select, insert, update, delete on table clinical.report_photo_note to open_triage_api_runtime;
grant select, insert, delete on table clinical.report_photo_blob to open_triage_api_runtime;
grant execute on function clinical.prevent_photo_blob_replacement() to open_triage_api_runtime;
