create function offline_recovery.checkpoint_report_ciphertext(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text
)
returns table (ciphertext_revision bigint, ciphertext_sha256 text)
language plpgsql
security definer
set search_path = pg_catalog, offline_recovery
as $$
declare
  current_envelope offline_recovery.report_key_envelope%rowtype;
begin
  if candidate_ciphertext_revision < 1 or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid protected ciphertext checkpoint' using errcode = '22023';
  end if;

  select * into current_envelope
  from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live'
    and envelope.recovery_deadline > now()
  for update;

  if not found then return; end if;
  if candidate_ciphertext_revision < current_envelope.ciphertext_revision then
    raise exception 'protected ciphertext rollback rejected' using errcode = '40001';
  end if;
  if candidate_ciphertext_revision = current_envelope.ciphertext_revision
     and current_envelope.ciphertext_sha256 is distinct from candidate_ciphertext_sha256 then
    raise exception 'protected ciphertext revision hash mismatch' using errcode = '23505';
  end if;

  update offline_recovery.report_key_envelope envelope
  set ciphertext_revision = candidate_ciphertext_revision,
      ciphertext_sha256 = candidate_ciphertext_sha256,
      updated_at = now()
  where envelope.report_id = candidate_report_id;

  return query select candidate_ciphertext_revision, candidate_ciphertext_sha256;
end;
$$;

revoke all on function offline_recovery.checkpoint_report_ciphertext(uuid, uuid, uuid, uuid, bigint, text) from public;
grant execute on function offline_recovery.checkpoint_report_ciphertext(uuid, uuid, uuid, uuid, bigint, text)
  to open_triage_offline_runtime;

comment on function offline_recovery.checkpoint_report_ciphertext(uuid, uuid, uuid, uuid, bigint, text) is
  'Monotonic server floor for authenticated browser ciphertext. Never-synchronized local revisions cannot be detected after complete client loss.';
