-- Operational overdue work is deliberately kept out of signed clinical analytics.
-- The organization-specific system criterion avoids a global rule-identity key
-- collision while remaining stable across worker retries and deployments.
create function clinical.review_overdue_criterion_id(organization_id uuid)
returns uuid language sql immutable strict as $$
  select (substr(digest,1,8) || '-' || substr(digest,9,4) || '-4' ||
    substr(digest,14,3) || '-8' || substr(digest,18,3) || '-' ||
    substr(digest,21,12))::uuid
  from (select md5('review-overdue-unsigned:' || organization_id::text) digest) hashed
$$;
grant execute on function clinical.review_overdue_criterion_id(uuid) to open_triage_api_runtime;

create table clinical.review_overdue_policy (
  organization_id uuid primary key references app_identity.organization(id),
  deadline_hours integer not null default 24 check (deadline_hours between 1 and 720),
  version bigint not null default 0 check (version >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, updated_by) references app_identity.app_user(organization_id, id)
);

create table clinical.review_overdue_policy_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  command_id uuid not null,
  actor_id uuid not null,
  deadline_hours integer not null check (deadline_hours between 1 and 720),
  version bigint not null check (version > 0),
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (organization_id, version),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id)
);
create trigger review_overdue_policy_history_append_only before update or delete
  on clinical.review_overdue_policy_history for each row
  execute function public.prevent_update_or_delete();

alter table clinical.review_item add column kind text not null default 'criterion'
  check (kind in ('criterion', 'overdue-unsigned')),
  add column deadline_basis_at timestamptz,
  add column deadline_source text check (deadline_source in ('call-completed', 'report-created')),
  add column deadline_at timestamptz,
  add column resolution_reason text,
  add constraint review_overdue_context_check check (
    (kind = 'criterion' and deadline_basis_at is null and deadline_source is null
      and deadline_at is null and resolution_reason is null)
    or (kind = 'overdue-unsigned' and deadline_basis_at is not null
      and deadline_source is not null and deadline_at is not null)
  );
create index review_overdue_open_idx on clinical.review_item (organization_id, deadline_at, id)
  where kind = 'overdue-unsigned' and status <> 'completed';
create index report_draft_created_idx on clinical.report (created_at, id)
  where status = 'draft';
create index occurrence_call_complete_idx on clinical.element_occurrence (report_id, updated_at desc)
  where element_id = 'eTimes.16' and tombstoned_at is null and value_kind = 'datetime';

create table clinical.review_overdue_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  item_id uuid not null,
  item_version bigint not null check (item_version >= 0),
  action text not null check (action in ('detected', 'resolved-by-signing')),
  actor_id uuid,
  recorded_at timestamptz not null default now(),
  unique (item_id, item_version),
  foreign key (organization_id, item_id) references clinical.review_item(organization_id, id),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id)
);
create index review_overdue_history_item_idx on clinical.review_overdue_history (item_id, item_version);
create trigger review_overdue_history_append_only before update or delete
  on clinical.review_overdue_history for each row
  execute function public.prevent_update_or_delete();

-- A signature and its automatic closure commit together. The scheduler locks the
-- same report row before creating a follow-up, preventing a sign/scan race.
create function clinical.resolve_overdue_on_signing() returns trigger language plpgsql as $$
declare changed record;
begin
  if old.status = 'draft' and new.status = 'signed' then
    for changed in
      update clinical.review_item item set status = 'completed',
        resolution_reason = 'resolved-by-signing', version = item.version + 1,
        updated_at = now()
      where item.report_id = new.id and item.organization_id = new.organization_id
        and item.kind = 'overdue-unsigned' and item.status <> 'completed'
      returning item.id, item.version, item.organization_id
    loop
      insert into clinical.review_overdue_history
        (organization_id, item_id, item_version, action)
      values (changed.organization_id, changed.id, changed.version, 'resolved-by-signing');
    end loop;
  end if;
  return new;
end $$;
create trigger review_resolve_overdue_on_signing after update of status on clinical.report
  for each row execute function clinical.resolve_overdue_on_signing();

revoke all on clinical.review_overdue_policy, clinical.review_overdue_policy_history,
  clinical.review_overdue_history from public, open_triage_api_runtime;
grant select, insert, update on clinical.review_overdue_policy to open_triage_api_runtime;
grant select, insert on clinical.review_overdue_policy_history,
  clinical.review_overdue_history to open_triage_api_runtime;
