-- The API may change only a draft photo's caption/audit columns. Canonical
-- identity, dimensions, size, hash, ownership, and bytes stay immutable.
revoke update on table clinical.report_photo_note from open_triage_api_runtime;
grant update (caption, updated_by, updated_at) on table clinical.report_photo_note
  to open_triage_api_runtime;

-- Blob deletion is performed only by the metadata row's ON DELETE CASCADE.
revoke delete on table clinical.report_photo_blob from open_triage_api_runtime;
