-- Read-only, installation-local feedback review surface. Reviewers receive no
-- table privileges: the two fixed-shape functions below are the complete read
-- workflow and deliberately cannot execute caller-supplied SQL.
alter table feedback.submission
  add column review_status text not null default 'new'
    check (review_status in ('new', 'triaged', 'planned', 'in_progress', 'resolved', 'declined', 'duplicate')),
  add column review_priority text
    check (review_priority in ('low', 'normal', 'high', 'urgent'));

create index feedback_submission_created_idx
  on feedback.submission (created_at desc, id desc);
create index feedback_submission_status_created_idx
  on feedback.submission (review_status, created_at desc, id desc);
create index feedback_submission_type_created_idx
  on feedback.submission (submission_type, created_at desc, id desc);
create index feedback_submission_priority_created_idx
  on feedback.submission (review_priority, created_at desc, id desc);

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_feedback_reviewer') then
    create role open_triage_feedback_reviewer
      nologin nosuperuser nocreatedb nocreaterole noinherit noreplication;
  end if;
end $$;

create or replace function feedback.review_queue(
  p_limit integer,
  p_status text default null,
  p_type text default null,
  p_priority text default null,
  p_unassigned_priority boolean default false,
  p_organization_id uuid default null,
  p_created_from timestamptz default null,
  p_created_before timestamptz default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id bigint default null
)
returns table (
  reference_code text,
  submission_type text,
  description_preview text,
  organization_id uuid,
  organization_display_name text,
  actor_display_name text,
  review_status text,
  review_priority text,
  created_at timestamptz,
  cursor_id bigint
)
language sql
stable
security definer
set search_path = pg_catalog, feedback
as $$
  select s.reference_code,
    s.submission_type,
    left(s.original_description, 240) as description_preview,
    s.organization_id,
    s.organization_display_name,
    s.actor_display_name,
    s.review_status,
    s.review_priority,
    s.created_at,
    s.id as cursor_id
  from feedback.submission s
  where (p_status is null or s.review_status = p_status)
    and (p_type is null or s.submission_type = p_type)
    and (p_priority is null or s.review_priority = p_priority)
    and (not p_unassigned_priority or s.review_priority is null)
    and (p_organization_id is null or s.organization_id = p_organization_id)
    and (p_created_from is null or s.created_at >= p_created_from)
    and (p_created_before is null or s.created_at < p_created_before)
    and ((p_cursor_created_at is null and p_cursor_id is null)
      or (p_cursor_created_at is not null and p_cursor_id is not null
        and (s.created_at, s.id) < (p_cursor_created_at, p_cursor_id)))
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 101)
$$;

create or replace function feedback.review_detail(p_reference_code text)
returns table (
  submission jsonb,
  diagnostics jsonb,
  review_history jsonb
)
language plpgsql
stable
security definer
set search_path = pg_catalog, feedback
as $$
declare
  v_submission_id bigint;
  v_submission jsonb;
  v_diagnostics jsonb := null;
  v_review_history jsonb := '[]'::jsonb;
begin
  select s.id,
    jsonb_build_object(
      'referenceCode', s.reference_code,
      'type', s.submission_type,
      'description', s.original_description,
      'organizationId', s.organization_id,
      'organizationDisplayName', s.organization_display_name,
      'actorDisplayName', s.actor_display_name,
      'status', s.review_status,
      'priority', s.review_priority,
      'createdAt', s.created_at
    )
  into v_submission_id, v_submission
  from feedback.submission s
  where s.reference_code = p_reference_code;

  if not found then
    return;
  end if;

  -- Diagnostic and review-event storage arrive in independent feature slices.
  -- These fixed queries begin returning their sanitized rows when those private
  -- tables exist, while remaining safe and useful for submission-only installs.
  if to_regclass('feedback.diagnostic') is not null then
    execute $query$
      select to_jsonb(d) - 'id' - 'submission_id'
      from feedback.diagnostic d
      where d.submission_id = $1
      limit 1
    $query$ into v_diagnostics using v_submission_id;
  end if;

  if to_regclass('feedback.review_event') is not null then
    execute $query$
      select coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'submission_id'
        order by e.created_at, e.id), '[]'::jsonb)
      from feedback.review_event e
      where e.submission_id = $1
    $query$ into v_review_history using v_submission_id;
  end if;

  return query select v_submission, v_diagnostics, v_review_history;
end
$$;

revoke all on function feedback.review_queue(integer, text, text, text, boolean, uuid,
  timestamptz, timestamptz, timestamptz, bigint) from public;
revoke all on function feedback.review_detail(text) from public;

grant usage on schema feedback to open_triage_feedback_reviewer;
grant execute on function feedback.review_queue(integer, text, text, text, boolean, uuid,
  timestamptz, timestamptz, timestamptz, bigint) to open_triage_feedback_reviewer;
grant execute on function feedback.review_detail(text) to open_triage_feedback_reviewer;

-- Be explicit even on installations where a deployment role carries defaults.
revoke all on table feedback.submission from open_triage_feedback_reviewer;
revoke all on sequence feedback.submission_id_seq from open_triage_feedback_reviewer;
