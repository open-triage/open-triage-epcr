-- Note target lineage is subordinate to its immutable report-change receipt.
-- Authorized demo deletion, retention, and rollout cleanup all delete receipts;
-- none may leave a foreign-key blocker introduced by note collaboration.
alter table clinical.report_note_target_state
  drop constraint report_note_target_state_report_id_revision_fkey,
  drop constraint report_note_target_state_report_id_command_id_fkey,
  add constraint report_note_target_state_report_id_revision_fkey
    foreign key (report_id, revision) references clinical.report_change(report_id, revision) on delete cascade,
  add constraint report_note_target_state_report_id_command_id_fkey
    foreign key (report_id, command_id) references clinical.report_change(report_id, idempotency_key) on delete cascade;

-- Child immutability guards need the parent to exist to validate the established
-- deletion authority. A foreign-key cascade runs after the parent is gone.
-- Delete guarded note children first; every existing guard still runs, and any
-- denial rolls back the entire statement. This uses the caller's privileges.
create function clinical.delete_report_note_dependencies()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  delete from clinical_audit.report_note_mutation_event where report_id = old.id;
  delete from clinical_audit.report_media_access_event where report_id = old.id;
  delete from clinical.report_photo_note where report_id = old.id;
  delete from clinical.report_audio_note where report_id = old.id;
  delete from clinical.report_note where report_id = old.id;
  return old;
end;
$$;

create trigger report_delete_note_dependencies
before delete on clinical.report
for each row execute function clinical.delete_report_note_dependencies();

revoke all on function clinical.delete_report_note_dependencies() from public;
grant execute on function clinical.delete_report_note_dependencies() to open_triage_api_runtime;
-- Keep clinical content out of the API's audit reads. Its DELETE authority is
-- still constrained by the append-only guard and the scoped synthetic marker.
grant select (report_id), delete on clinical_audit.report_note_mutation_event,
  clinical_audit.report_media_access_event to open_triage_api_runtime;
