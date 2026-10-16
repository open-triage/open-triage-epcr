-- Private, short-lived per-attempt authority. Never personal authentication proof.
create table app_identity.new_job_confirmation (
 token_sha256 text primary key check (token_sha256 ~ '^[a-f0-9]{64}$'),
 session_sha256 text not null check (session_sha256 ~ '^[a-f0-9]{64}$'),
 target text not null check (target ~ '^(assignment|command):[a-f0-9-]{36}$'),
 context_sha256 text not null check (context_sha256 ~ '^[a-f0-9]{64}$'),
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '5 minutes',
 consumed_at timestamptz,
 check (expires_at > issued_at)
);
create index new_job_confirmation_session_expiry_idx on app_identity.new_job_confirmation(session_sha256,expires_at);
alter table app_identity.new_job_confirmation enable row level security;
revoke all on app_identity.new_job_confirmation from public,open_triage_api_runtime;
grant select,insert,update,delete on app_identity.new_job_confirmation to open_triage_api_runtime;
create policy new_job_confirmation_runtime on app_identity.new_job_confirmation to open_triage_api_runtime using (true) with check (true);
