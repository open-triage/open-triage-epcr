-- Append-only triggers call this narrow authorization predicate before checking
-- ordinary application deletion paths. Runtime callers must be able to execute
-- it, while the predicate itself continues to authorize only the migration
-- executor role and its explicitly selected unsigned report.
grant execute on function clinical.unsigned_rollout_deletion_is_authorized(uuid)
  to open_triage_api_runtime;
