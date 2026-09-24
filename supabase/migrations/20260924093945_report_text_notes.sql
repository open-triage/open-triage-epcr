-- App-native report notes deliberately live outside the NEMSIS encounter
-- document. Text is normalized by the API before it reaches this table; the
-- checks below are a second line of defense for direct database writes.
create table clinical.report_note (
  id uuid primary key
    check (substring(id::text from 15 for 1) = '4'
      and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  note_type text not null default 'text' check (note_type = 'text'),
  captured_at timestamptz not null,
  captured_utc_offset_minutes smallint not null
    check (captured_utc_offset_minutes between -840 and 840),
  content text not null
    check (char_length(content) between 1 and 10000)
    check (content = btrim(content))
    check (regexp_replace(content, E'[\\t\\n\\r]', '', 'g') !~ '[[:cntrl:]]'),
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

create index report_note_timeline_idx
on clinical.report_note (report_id, captured_at desc, id desc);

create trigger report_note_signed_immutable
before insert or update or delete on clinical.report_note
for each row execute function clinical.prevent_signed_report_mutation();

comment on table clinical.report_note is
  'App-native report notes stored separately from the standards-based encounter document.';

-- clinical is a private application schema rather than an exposed Data API
-- schema. Keep public roles out and grant only the established API workload.
revoke all on table clinical.report_note from public, anon, authenticated;
grant select, insert, update, delete on table clinical.report_note
  to open_triage_api_runtime;
