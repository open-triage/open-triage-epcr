-- Native redemption is separate from the browser bootstrap/correlation secret.
-- No provider or application credential is carried in the Android return URI.
alter table app_identity.oidc_personal_transaction
 add column native_return_sha256 text check(native_return_sha256 ~ '^[a-f0-9]{64}$'),
 add column native_state text check(native_state ~ '^[A-Za-z0-9_-]{43}$'),
 add column native_started_at timestamptz,
 add column native_delivered_at timestamptz,
 add column native_result jsonb check(native_result is null or jsonb_typeof(native_result)='object'),
 add constraint oidc_native_binding check((native_return_sha256 is null)=(native_state is null));
create unique index oidc_personal_native_return on app_identity.oidc_personal_transaction(native_return_sha256) where native_return_sha256 is not null;
create index oidc_personal_native_start on app_identity.oidc_personal_transaction(correlation_sha256) where native_return_sha256 is not null;
grant update(native_started_at,native_delivered_at,native_result) on app_identity.oidc_personal_transaction to open_triage_api_runtime;
