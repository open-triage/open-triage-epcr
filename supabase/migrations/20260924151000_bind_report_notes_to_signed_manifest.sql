-- Signed reports bind app-native notes and their media integrity evidence into
-- the same immutable snapshot as the standards-based encounter document.
alter table clinical.signed_snapshot
  add column integrity_manifest jsonb not null
    default '{"schemaVersion":1,"legacy":true,"notes":[]}'::jsonb,
  add constraint signed_snapshot_integrity_manifest_check check (
    jsonb_typeof(integrity_manifest) = 'object'
    and integrity_manifest->>'schemaVersion' = '1'
    and jsonb_typeof(integrity_manifest->'notes') = 'array'
  );

alter table clinical.report_photo_note
  add column processing_state text not null default 'ready'
    check (processing_state in ('uploading', 'processing', 'ready', 'failed'));

alter table clinical.report_audio_note
  drop constraint report_audio_note_processing_state_check,
  add constraint report_audio_note_processing_state_check
    check (processing_state in ('uploading', 'processing', 'ready', 'failed'));

comment on column clinical.signed_snapshot.integrity_manifest is
  'Canonical report-and-note manifest whose SHA-256 digest is canonical_sha256.';

-- Capture provenance and integrity metadata cannot be rewritten. State may
-- advance while a report is draft, but the signed-report trigger freezes it.
create function clinical.prevent_report_media_integrity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.content_type is distinct from old.content_type
     or new.byte_size is distinct from old.byte_size
     or new.sha256 is distinct from old.sha256
     or (tg_table_name = 'report_photo_note' and (
       (to_jsonb(new)->>'width') is distinct from (to_jsonb(old)->>'width')
       or (to_jsonb(new)->>'height') is distinct from (to_jsonb(old)->>'height')
     ))
     or (tg_table_name = 'report_audio_note' and
       (to_jsonb(new)->>'duration_milliseconds') is distinct from
         (to_jsonb(old)->>'duration_milliseconds')) then
    raise exception 'Report media integrity metadata is immutable';
  end if;
  return new;
end;
$$;

create trigger report_photo_integrity_immutable
before update on clinical.report_photo_note
for each row execute function clinical.prevent_report_media_integrity_change();

create trigger report_audio_integrity_immutable
before update on clinical.report_audio_note
for each row execute function clinical.prevent_report_media_integrity_change();

revoke execute on function clinical.prevent_report_media_integrity_change()
  from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke execute on function clinical.prevent_report_media_integrity_change() from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

grant execute on function clinical.prevent_report_media_integrity_change()
  to open_triage_api_runtime;
