-- Human-approved feedback triage. All writes pass through one atomic,
-- optimistic-concurrency function; the reviewer role still has no table access.
alter table feedback.submission
  add column approved_summary text
    check (approved_summary is null or (
      char_length(approved_summary) between 1 and 1000
      and approved_summary = btrim(approved_summary))),
  add column approved_review_note text,
  add column review_version bigint not null default 0
    check (review_version >= 0),
  add column review_updated_at timestamptz;

update feedback.submission
set review_updated_at = created_at;

alter table feedback.submission
  alter column review_updated_at set not null,
  alter column review_updated_at set default now(),
  add constraint feedback_submission_review_note_check check (
    approved_review_note is null or (
      char_length(approved_review_note) between 1 and 4000
      and approved_review_note = btrim(approved_review_note)));

create table feedback.review_event (
  id bigint generated always as identity primary key,
  submission_id bigint not null references feedback.submission(id),
  review_version bigint not null check (review_version > 0),
  review_status text not null
    check (review_status in ('new', 'triaged', 'planned', 'in_progress', 'resolved', 'declined', 'duplicate')),
  review_priority text not null
    check (review_priority in ('low', 'normal', 'high', 'urgent')),
  approved_summary text
    check (approved_summary is null or (
      char_length(approved_summary) between 1 and 1000
      and approved_summary = btrim(approved_summary))),
  review_note text not null
    check (char_length(review_note) between 1 and 4000
      and review_note = btrim(review_note)),
  reviewer_type text not null
    check (reviewer_type in ('human', 'ai_assisted')),
  human_reviewer_id text not null
    check (char_length(human_reviewer_id) between 1 and 200
      and human_reviewer_id = btrim(human_reviewer_id)),
  model_identifier text,
  review_run_id text,
  reviewed_at timestamptz not null,
  unique (submission_id, review_version),
  check (
    (reviewer_type = 'human' and model_identifier is null and review_run_id is null)
    or
    (reviewer_type = 'ai_assisted'
      and model_identifier is not null
      and char_length(model_identifier) between 1 and 200
      and model_identifier = btrim(model_identifier)
      and review_run_id is not null
      and char_length(review_run_id) between 1 and 200
      and review_run_id = btrim(review_run_id))
  )
);

create index feedback_review_event_submission_created_idx
  on feedback.review_event (submission_id, reviewed_at, id);

revoke all on table feedback.review_event from public;
revoke all on sequence feedback.review_event_id_seq from public;

create or replace function feedback.protect_submission_content()
returns trigger
language plpgsql
set search_path = pg_catalog, feedback
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'feedback submissions are append-only';
  end if;

  if (new.id, new.reference_code, new.idempotency_key, new.submission_type,
      new.original_description, new.organization_id, new.actor_id,
      new.organization_display_name, new.actor_display_name, new.created_at)
    is distinct from
     (old.id, old.reference_code, old.idempotency_key, old.submission_type,
      old.original_description, old.organization_id, old.actor_id,
      old.organization_display_name, old.actor_display_name, old.created_at) then
    raise exception 'feedback submissions are append-only; original content is immutable';
  end if;
  return new;
end
$$;

drop trigger feedback_submission_immutable on feedback.submission;
create trigger feedback_submission_immutable
before update or delete on feedback.submission
for each row execute function feedback.protect_submission_content();

create trigger feedback_review_event_immutable
before update or delete on feedback.review_event
for each row execute function public.prevent_update_or_delete();

create or replace function feedback.record_review_decision(
  p_reference_code text,
  p_expected_version bigint,
  p_status text,
  p_priority text,
  p_summary text,
  p_review_note text,
  p_reviewer_type text,
  p_human_reviewer_id text,
  p_model_identifier text default null,
  p_review_run_id text default null
)
returns table (
  reference_code text,
  review_version bigint,
  review_status text,
  review_priority text,
  approved_summary text,
  approved_review_note text,
  reviewer_type text,
  human_reviewer_id text,
  model_identifier text,
  review_run_id text,
  reviewed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, feedback
as $$
declare
  v_submission feedback.submission%rowtype;
  v_reviewed_at timestamptz := clock_timestamp();
begin
  if p_expected_version is null or p_expected_version < 0 then
    raise exception using errcode = 'PT003', message = 'expected review version is required';
  end if;
  if p_status is null or p_status not in ('new', 'triaged', 'planned', 'in_progress', 'resolved', 'declined', 'duplicate') then
    raise exception using errcode = 'PT003', message = 'invalid review status';
  end if;
  if p_priority is null or p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception using errcode = 'PT003', message = 'invalid review priority';
  end if;
  if p_review_note is null or char_length(btrim(p_review_note)) not between 1 and 4000
      or p_review_note <> btrim(p_review_note) then
    raise exception using errcode = 'PT003', message = 'invalid review note';
  end if;
  if p_summary is not null and (char_length(p_summary) not between 1 and 1000
      or p_summary <> btrim(p_summary)) then
    raise exception using errcode = 'PT003', message = 'invalid approved summary';
  end if;
  if p_human_reviewer_id is null or char_length(btrim(p_human_reviewer_id)) not between 1 and 200
      or p_human_reviewer_id <> btrim(p_human_reviewer_id) then
    raise exception using errcode = 'PT003', message = 'invalid human reviewer';
  end if;
  if p_reviewer_type = 'human' then
    if p_model_identifier is not null or p_review_run_id is not null then
      raise exception using errcode = 'PT003', message = 'human reviews cannot carry AI provenance';
    end if;
  elsif p_reviewer_type = 'ai_assisted' then
    if p_model_identifier is null or char_length(btrim(p_model_identifier)) not between 1 and 200
        or p_model_identifier <> btrim(p_model_identifier)
        or p_review_run_id is null or char_length(btrim(p_review_run_id)) not between 1 and 200
        or p_review_run_id <> btrim(p_review_run_id) then
      raise exception using errcode = 'PT003', message = 'AI-assisted reviews require model and review-run identifiers';
    end if;
  else
    raise exception using errcode = 'PT003', message = 'invalid reviewer type';
  end if;

  select s.* into v_submission
  from feedback.submission s
  where s.reference_code = p_reference_code
  for update;

  if not found then
    raise exception using errcode = 'PT001', message = 'feedback submission not found';
  end if;
  if v_submission.review_version <> p_expected_version then
    raise exception using errcode = 'PT002', message = 'stale review decision';
  end if;

  insert into feedback.review_event (
    submission_id, review_version, review_status, review_priority,
    approved_summary, review_note, reviewer_type, human_reviewer_id,
    model_identifier, review_run_id, reviewed_at
  ) values (
    v_submission.id, v_submission.review_version + 1, p_status, p_priority,
    p_summary, p_review_note, p_reviewer_type, p_human_reviewer_id,
    p_model_identifier, p_review_run_id, v_reviewed_at
  );

  update feedback.submission s
  set review_status = p_status,
    review_priority = p_priority,
    approved_summary = p_summary,
    approved_review_note = p_review_note,
    review_version = v_submission.review_version + 1,
    review_updated_at = v_reviewed_at
  where s.id = v_submission.id;

  return query select p_reference_code, v_submission.review_version + 1,
    p_status, p_priority, p_summary, p_review_note, p_reviewer_type,
    p_human_reviewer_id, p_model_identifier, p_review_run_id, v_reviewed_at;
end
$$;

revoke all on function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text) from public;
grant execute on function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text) to open_triage_feedback_reviewer;

revoke all on table feedback.submission from open_triage_feedback_reviewer;
revoke all on table feedback.review_event from open_triage_feedback_reviewer;
revoke all on sequence feedback.review_event_id_seq from open_triage_feedback_reviewer;

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
      'approvedSummary', s.approved_summary,
      'approvedReviewNote', s.approved_review_note,
      'reviewVersion', s.review_version,
      'reviewUpdatedAt', s.review_updated_at,
      'createdAt', s.created_at
    )
  into v_submission_id, v_submission
  from feedback.submission s
  where s.reference_code = p_reference_code;

  if not found then
    return;
  end if;

  if to_regclass('feedback.diagnostic') is not null then
    execute $query$
      select to_jsonb(d) - 'id' - 'submission_id'
      from feedback.diagnostic d
      where d.submission_id = $1
      limit 1
    $query$ into v_diagnostics using v_submission_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'version', e.review_version,
    'status', e.review_status,
    'priority', e.review_priority,
    'approvedSummary', e.approved_summary,
    'reviewNote', e.review_note,
    'reviewerType', e.reviewer_type,
    'humanReviewerId', e.human_reviewer_id,
    'modelIdentifier', e.model_identifier,
    'reviewRunId', e.review_run_id,
    'reviewedAt', e.reviewed_at
  ) order by e.review_version), '[]'::jsonb)
  into v_review_history
  from feedback.review_event e
  where e.submission_id = v_submission_id;

  return query select v_submission, v_diagnostics, v_review_history;
end
$$;

revoke all on function feedback.review_detail(text) from public;
grant execute on function feedback.review_detail(text) to open_triage_feedback_reviewer;
