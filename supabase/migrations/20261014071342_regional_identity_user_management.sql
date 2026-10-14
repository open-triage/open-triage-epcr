-- A denied request remains denied when the same validated identity signs in again.
-- Only an explicit, revision-bound review may reconsider it. No account is created.
alter table app_identity.regional_identity_request
  add column review_revision bigint not null default 1 check (review_revision > 0),
  add column denied_at timestamptz,
  add column denied_by uuid references app_identity.app_user(id),
  add column denial_note text check (char_length(denial_note) <= 1000),
  add constraint regional_identity_denial_complete check (
    (denied_at is null and denied_by is null and denial_note is null)
    or (denied_at is not null and denied_by is not null and linked_user_id is null)
  );
create index regional_identity_denied_actor on app_identity.regional_identity_request(denied_by)
  where denied_by is not null;
grant update(review_revision, denied_at, denied_by, denial_note)
  on app_identity.regional_identity_request to open_triage_api_runtime;
