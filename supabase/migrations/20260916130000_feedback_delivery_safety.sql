-- Give every draft a stable actor-scoped command identity. Existing submissions
-- receive unique keys so the new not-null invariant can be introduced safely.
alter table feedback.submission add column idempotency_key uuid;

update feedback.submission set idempotency_key = gen_random_uuid();

alter table feedback.submission alter column idempotency_key set not null;

alter table feedback.submission
  add constraint feedback_submission_actor_idempotency_key_unique
  unique (actor_id, idempotency_key);
