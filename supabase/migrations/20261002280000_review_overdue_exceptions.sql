-- Exception reasons are fixed operational codes, never free text from a report.
alter table clinical.review_item add column exception_code text
  check (exception_code in ('duplicate-follow-up', 'report-not-required', 'administrative-exception')),
  add constraint review_overdue_exception_context_check check (
    (resolution_reason is not distinct from 'closed-exceptionally' and kind = 'overdue-unsigned'
      and status = 'completed' and exception_code is not null)
    or (resolution_reason is distinct from 'closed-exceptionally' and exception_code is null)
  );

alter table clinical.review_overdue_history
  drop constraint review_overdue_history_action_check,
  add column command_id uuid,
  add column reason_code text
    check (reason_code in ('duplicate-follow-up', 'report-not-required', 'administrative-exception')),
  add constraint review_overdue_history_action_check check (
    (action = 'closed-exceptionally' and command_id is not null
      and actor_id is not null and reason_code is not null)
    or (action in ('detected', 'resolved-by-signing', 'signed-after-exception')
      and command_id is null and reason_code is null)
  );
create unique index review_overdue_exception_command_idx
  on clinical.review_overdue_history (organization_id, command_id)
  where command_id is not null;

-- Signing a previously excepted draft records reconciliation without replacing
-- the administrator's exceptional closure or its reason.
create or replace function clinical.resolve_overdue_on_signing() returns trigger language plpgsql as $$
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
    for changed in
      update clinical.review_item item set version = item.version + 1, updated_at = now()
      where item.report_id = new.id and item.organization_id = new.organization_id
        and item.kind = 'overdue-unsigned' and item.status = 'completed'
        and item.resolution_reason = 'closed-exceptionally'
      returning item.id, item.version, item.organization_id
    loop
      insert into clinical.review_overdue_history
        (organization_id, item_id, item_version, action)
      values (changed.organization_id, changed.id, changed.version, 'signed-after-exception');
    end loop;
  end if;
  return new;
end $$;
