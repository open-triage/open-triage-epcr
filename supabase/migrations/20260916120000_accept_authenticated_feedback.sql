-- Installation-local feedback intake. This schema is deliberately private:
-- authenticated application users submit through the server API and receive no
-- database or HTTP read surface.
create schema feedback;
revoke all on schema feedback from public;

create table feedback.submission (
  id bigint generated always as identity primary key,
  reference_code text not null unique
    check (reference_code ~ '^[A-Z2-7]{12}$'),
  submission_type text not null
    check (submission_type in ('bug', 'feature')),
  original_description text not null
    check (char_length(original_description) between 1 and 4000
      and original_description = btrim(original_description)),
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null,
  organization_display_name text not null
    check (char_length(btrim(organization_display_name)) between 1 and 200),
  actor_display_name text not null
    check (char_length(btrim(actor_display_name)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id)
);

create index feedback_submission_organization_created_idx
  on feedback.submission (organization_id, created_at desc, id desc);
create index feedback_submission_actor_created_idx
  on feedback.submission (actor_id, created_at desc, id desc);

create trigger feedback_submission_immutable
before update or delete on feedback.submission
for each row execute function public.prevent_update_or_delete();

revoke all on table feedback.submission from public;
revoke all on sequence feedback.submission_id_seq from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_feedback_writer') then
    create role open_triage_feedback_writer nologin;
  end if;
end $$;

grant usage on schema feedback to open_triage_feedback_writer;
grant insert on table feedback.submission to open_triage_feedback_writer;
grant usage on sequence feedback.submission_id_seq to open_triage_feedback_writer;
