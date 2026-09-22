-- A second authorized browser may recover the report key without possessing
-- the first browser's ciphertext. Its revision and rollback checkpoint must be
-- independent so neither browser can invalidate the other's pending work.
create table offline_recovery.report_browser_ciphertext (
  report_id uuid not null references offline_recovery.report_key_envelope(report_id) on delete cascade,
  local_record_id uuid not null,
  ciphertext_revision bigint not null check (ciphertext_revision > 0),
  synchronized_revision bigint not null default 0
    check (synchronized_revision >= 0 and synchronized_revision <= ciphertext_revision),
  ciphertext_sha256 text not null check (ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (report_id, local_record_id)
);

revoke all on offline_recovery.report_browser_ciphertext from public;

create function offline_recovery.record_browser_ciphertext_write(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_local_record_id uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text
)
returns table (recovery_deadline timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_window integer;
  selected_report_expiry timestamptz;
  selected_deadline timestamptz;
  selected_now timestamptz := clock_timestamp();
  prior_revision bigint;
begin
  if candidate_local_record_id is null or candidate_ciphertext_revision < 1
     or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then return; end if;
  perform offline_recovery.expire_due_report_keys(selected_now);

  -- The parent lock serializes writes for the same report and prevents a
  -- concurrent purge or expiry from racing this browser's receipt.
  select envelope.* into selected_envelope
  from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live'
    and envelope.recovery_deadline > selected_now
  for update;
  if not found or exists (select 1 from offline_recovery.report_purge_tombstone
      where report_id = candidate_report_id) then return; end if;

  select organization.offline_recovery_window_hours, report.expires_at
    into selected_window, selected_report_expiry
  from clinical.report report
  join app_identity.organization organization on organization.id = report.organization_id
  where report.id = candidate_report_id
    and report.organization_id = candidate_organization_id
    and report.documenting_user_id = candidate_owner_user_id
    and report.status = 'draft';
  if not found then return; end if;

  select browser.ciphertext_revision into prior_revision
  from offline_recovery.report_browser_ciphertext browser
  where browser.report_id = candidate_report_id
    and browser.local_record_id = candidate_local_record_id;
  if prior_revision is not null and candidate_ciphertext_revision <= prior_revision then return; end if;

  selected_deadline := selected_now + make_interval(hours => selected_window);
  if selected_report_expiry is not null then
    selected_deadline := least(selected_deadline, selected_report_expiry);
  end if;
  if selected_deadline <= selected_now then return; end if;

  insert into offline_recovery.report_browser_ciphertext
    (report_id, local_record_id, ciphertext_revision, ciphertext_sha256, updated_at)
  values (candidate_report_id, candidate_local_record_id,
    candidate_ciphertext_revision, candidate_ciphertext_sha256, selected_now)
  on conflict (report_id, local_record_id) do update
  set ciphertext_revision = excluded.ciphertext_revision,
      ciphertext_sha256 = excluded.ciphertext_sha256,
      updated_at = selected_now;

  update offline_recovery.report_key_envelope envelope
  set recovery_deadline = greatest(envelope.recovery_deadline, selected_deadline),
      updated_at = selected_now
  where envelope.report_id = candidate_report_id;

  insert into offline_recovery.event
    (organization_id, report_id, recovery_handle, event_type,
     ciphertext_revision, occurred_at)
  values (candidate_organization_id, candidate_report_id,
    candidate_recovery_handle, 'ciphertext_written',
    candidate_ciphertext_revision, selected_now);

  return query select greatest(selected_envelope.recovery_deadline, selected_deadline);
end;
$$;

create function offline_recovery.checkpoint_browser_ciphertext(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_local_record_id uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text
)
returns table (ciphertext_revision bigint, ciphertext_sha256 text)
language plpgsql security definer set search_path = '' as $$
declare current_browser offline_recovery.report_browser_ciphertext%rowtype;
begin
  if candidate_local_record_id is null or candidate_ciphertext_revision < 1
     or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid protected ciphertext checkpoint' using errcode = '22023';
  end if;
  if exists (select 1 from offline_recovery.report_purge_tombstone
      where report_id = candidate_report_id) then return; end if;
  if not exists (
    select 1 from offline_recovery.report_key_envelope envelope
    where envelope.report_id = candidate_report_id
      and envelope.organization_id = candidate_organization_id
      and envelope.owner_user_id = candidate_owner_user_id
      and envelope.recovery_handle = candidate_recovery_handle
      and envelope.state = 'live' and envelope.recovery_deadline > now()
  ) then return; end if;

  select browser.* into current_browser
  from offline_recovery.report_browser_ciphertext browser
  where browser.report_id = candidate_report_id
    and browser.local_record_id = candidate_local_record_id
  for update;
  if not found then return; end if;
  if candidate_ciphertext_revision < current_browser.synchronized_revision
     or candidate_ciphertext_revision <> current_browser.ciphertext_revision then
    raise exception 'protected ciphertext rollback rejected' using errcode = '40001';
  end if;
  if candidate_ciphertext_sha256 <> current_browser.ciphertext_sha256 then
    raise exception 'protected ciphertext revision hash mismatch' using errcode = '23505';
  end if;
  update offline_recovery.report_browser_ciphertext browser
  set synchronized_revision = candidate_ciphertext_revision, updated_at = clock_timestamp()
  where browser.report_id = candidate_report_id
    and browser.local_record_id = candidate_local_record_id;
  return query select candidate_ciphertext_revision, candidate_ciphertext_sha256;
end;
$$;

revoke all on function offline_recovery.record_browser_ciphertext_write(
  uuid, uuid, uuid, uuid, uuid, bigint, text),
  offline_recovery.checkpoint_browser_ciphertext(
  uuid, uuid, uuid, uuid, uuid, bigint, text) from public;
grant execute on function offline_recovery.record_browser_ciphertext_write(
  uuid, uuid, uuid, uuid, uuid, bigint, text),
  offline_recovery.checkpoint_browser_ciphertext(
  uuid, uuid, uuid, uuid, uuid, bigint, text) to open_triage_api_runtime;
