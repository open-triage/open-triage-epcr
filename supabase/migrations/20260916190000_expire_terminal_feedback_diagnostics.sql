-- Installation-local diagnostic expiry. Original submissions and review history
-- remain untouched; the fixed operation can only remove eligible diagnostics.
create index feedback_submission_terminal_diagnostic_expiry_idx
  on feedback.submission (review_updated_at, id)
  where review_status in ('resolved', 'declined', 'duplicate');

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_feedback_retention') then
    create role open_triage_feedback_retention
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end $$;

create or replace function feedback.expire_terminal_diagnostics(p_batch_size integer)
returns table (deleted_count integer, remaining_eligible integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, feedback
as $$
declare
  v_deleted integer;
  v_remaining integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 1000 then
    raise exception using errcode = 'PT003', message = 'batch size must be between 1 and 1000';
  end if;

  with candidates as materialized (
    select d.submission_id
    from feedback.submission s
    join feedback.diagnostic d on d.submission_id = s.id
    where s.review_status in ('resolved', 'declined', 'duplicate')
      and s.review_updated_at <= clock_timestamp() - interval '30 days'
    order by s.review_updated_at, s.id
    for update of d skip locked
    limit p_batch_size
  ), removed as (
    delete from feedback.diagnostic d
    using candidates c
    where d.submission_id = c.submission_id
    returning d.submission_id
  )
  select count(*)::integer into v_deleted from removed;

  select count(*)::integer into v_remaining
  from (
    select 1
    from feedback.submission s
    join feedback.diagnostic d on d.submission_id = s.id
    where s.review_status in ('resolved', 'declined', 'duplicate')
      and s.review_updated_at <= clock_timestamp() - interval '30 days'
    order by s.review_updated_at, s.id
    limit p_batch_size
  ) pending;

  return query select v_deleted, v_remaining;
end
$$;

revoke all on function feedback.expire_terminal_diagnostics(integer) from public;
grant usage on schema feedback to open_triage_feedback_retention;
grant execute on function feedback.expire_terminal_diagnostics(integer)
  to open_triage_feedback_retention;

revoke all on table feedback.submission from open_triage_feedback_retention;
revoke all on table feedback.diagnostic from open_triage_feedback_retention;
revoke all on table feedback.review_event from open_triage_feedback_retention;
