-- Canonical duplicate and separately approved downstream-work relationships.
-- Both the current projection and every immutable decision event retain the
-- exact relationship state approved by the human reviewer.
alter table feedback.submission
  add column canonical_submission_id bigint
    references feedback.submission(id),
  add column external_work_kind text
    check (external_work_kind in ('issue', 'pull_request')),
  add column external_work_url text,
  add constraint feedback_submission_canonical_not_self_check
    check (canonical_submission_id is null or canonical_submission_id <> id),
  add constraint feedback_submission_external_work_check check (
    (external_work_kind is null and external_work_url is null)
    or
    (external_work_kind is not null and external_work_url is not null
      and char_length(external_work_url) between 9 and 2000
      and external_work_url = btrim(external_work_url)
      and external_work_url ~ '^https://[^[:space:]]+$')),
  add constraint feedback_submission_duplicate_target_check
    check ((review_status = 'duplicate') = (canonical_submission_id is not null)) not valid;

create index feedback_submission_canonical_idx
  on feedback.submission (canonical_submission_id)
  where canonical_submission_id is not null;

alter table feedback.review_event
  add column canonical_submission_id bigint
    references feedback.submission(id),
  add column external_work_kind text
    check (external_work_kind in ('issue', 'pull_request')),
  add column external_work_url text,
  add constraint feedback_review_event_canonical_not_self_check
    check (canonical_submission_id is null or canonical_submission_id <> submission_id),
  add constraint feedback_review_event_external_work_check check (
    (external_work_kind is null and external_work_url is null)
    or
    (external_work_kind is not null and external_work_url is not null
      and char_length(external_work_url) between 9 and 2000
      and external_work_url = btrim(external_work_url)
      and external_work_url ~ '^https://[^[:space:]]+$')),
  add constraint feedback_review_event_duplicate_target_check
    check ((review_status = 'duplicate') = (canonical_submission_id is not null)) not valid;

create index feedback_review_event_canonical_idx
  on feedback.review_event (canonical_submission_id)
  where canonical_submission_id is not null;

revoke all on function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text) from open_triage_feedback_reviewer;
drop function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text);

create function feedback.record_review_decision(
  p_reference_code text,
  p_expected_version bigint,
  p_status text,
  p_priority text,
  p_summary text,
  p_review_note text,
  p_reviewer_type text,
  p_human_reviewer_id text,
  p_model_identifier text default null,
  p_review_run_id text default null,
  p_duplicate_of_reference text default null,
  p_external_work_kind text default null,
  p_external_work_url text default null
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
  duplicate_of_reference text,
  external_work_kind text,
  external_work_url text,
  reviewed_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, feedback
as $$
declare
  v_submission feedback.submission%rowtype;
  v_canonical feedback.submission%rowtype;
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
  if (p_external_work_kind is null) <> (p_external_work_url is null)
      or (p_external_work_kind is not null and p_external_work_kind not in ('issue', 'pull_request'))
      or (p_external_work_url is not null and (
        char_length(p_external_work_url) not between 9 and 2000
        or p_external_work_url <> btrim(p_external_work_url)
        or p_external_work_url !~ '^https://[^[:space:]]+$')) then
    raise exception using errcode = 'PT003', message = 'invalid external work link';
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

  if p_status = 'duplicate' then
    if p_duplicate_of_reference is null or p_duplicate_of_reference = p_reference_code then
      raise exception using errcode = 'PT003', message = 'duplicate status requires another canonical submission';
    end if;
    select s.* into v_canonical
    from feedback.submission s
    where s.reference_code = p_duplicate_of_reference;
    if not found then
      raise exception using errcode = 'PT004', message = 'canonical feedback submission not found';
    end if;
  elsif p_duplicate_of_reference is not null then
    raise exception using errcode = 'PT003', message = 'only duplicate status accepts a canonical submission';
  end if;

  insert into feedback.review_event (
    submission_id, review_version, review_status, review_priority,
    approved_summary, review_note, reviewer_type, human_reviewer_id,
    model_identifier, review_run_id, canonical_submission_id,
    external_work_kind, external_work_url, reviewed_at
  ) values (
    v_submission.id, v_submission.review_version + 1, p_status, p_priority,
    p_summary, p_review_note, p_reviewer_type, p_human_reviewer_id,
    p_model_identifier, p_review_run_id, v_canonical.id,
    p_external_work_kind, p_external_work_url, v_reviewed_at
  );

  update feedback.submission s
  set review_status = p_status,
    review_priority = p_priority,
    approved_summary = p_summary,
    approved_review_note = p_review_note,
    canonical_submission_id = v_canonical.id,
    external_work_kind = p_external_work_kind,
    external_work_url = p_external_work_url,
    review_version = v_submission.review_version + 1,
    review_updated_at = v_reviewed_at
  where s.id = v_submission.id;

  return query select p_reference_code, v_submission.review_version + 1,
    p_status, p_priority, p_summary, p_review_note, p_reviewer_type,
    p_human_reviewer_id, p_model_identifier, p_review_run_id,
    p_duplicate_of_reference, p_external_work_kind, p_external_work_url, v_reviewed_at;
end
$$;

revoke all on function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text, text, text, text) from public;
grant execute on function feedback.record_review_decision(text, bigint, text, text,
  text, text, text, text, text, text, text, text, text) to open_triage_feedback_reviewer;

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
      'duplicateOfReference', canonical.reference_code,
      'externalWork', case when s.external_work_url is null then null else jsonb_build_object(
        'kind', s.external_work_kind, 'url', s.external_work_url) end,
      'reviewVersion', s.review_version,
      'reviewUpdatedAt', s.review_updated_at,
      'createdAt', s.created_at
    )
  into v_submission_id, v_submission
  from feedback.submission s
  left join feedback.submission canonical on canonical.id = s.canonical_submission_id
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
    'duplicateOfReference', canonical.reference_code,
    'externalWork', case when e.external_work_url is null then null else jsonb_build_object(
      'kind', e.external_work_kind, 'url', e.external_work_url) end,
    'reviewedAt', e.reviewed_at
  ) order by e.review_version), '[]'::jsonb)
  into v_review_history
  from feedback.review_event e
  left join feedback.submission canonical on canonical.id = e.canonical_submission_id
  where e.submission_id = v_submission_id;

  return query select v_submission, v_diagnostics, v_review_history;
end
$$;

revoke all on function feedback.review_detail(text) from public;
grant execute on function feedback.review_detail(text) to open_triage_feedback_reviewer;

revoke all on table feedback.submission from open_triage_feedback_reviewer;
revoke all on table feedback.review_event from open_triage_feedback_reviewer;
