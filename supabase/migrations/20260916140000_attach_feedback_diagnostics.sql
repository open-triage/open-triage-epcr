-- Diagnostic payloads remain private, bounded, and separately removable from
-- the original feedback submission. The API admits only its versioned schema.
create table feedback.diagnostic (
  submission_id bigint primary key
    references feedback.submission(id) on delete cascade,
  diagnostic_status text not null
    check (diagnostic_status in ('available', 'unavailable')),
  schema_version smallint not null
    check (schema_version = 1),
  unavailable_reason text
    check (unavailable_reason in ('capture-failed', 'serialization-failed')),
  payload jsonb,
  created_at timestamptz not null default now(),
  check (
    (diagnostic_status = 'available' and payload is not null and unavailable_reason is null)
    or
    (diagnostic_status = 'unavailable' and payload is null and unavailable_reason is not null)
  ),
  check (payload is null or pg_column_size(payload) <= 16384)
);

revoke all on table feedback.diagnostic from public;
grant insert on table feedback.diagnostic to open_triage_feedback_writer;
