-- Only hashes of a native-only retry capability and its exact original request.
-- Existing private-schema runtime grants and tenant checks remain unchanged.
alter table app_identity.unit_enrollment
 add column native_attempt_sha256 text,
 add column native_binding_sha256 text,
 add constraint unit_enrollment_native_attempt_valid check (
  (native_attempt_sha256 is null and native_binding_sha256 is null) or
  (consumed_at is not null and native_attempt_sha256 is not null and native_binding_sha256 is not null and native_attempt_sha256 ~ '^[a-f0-9]{64}$'
   and native_binding_sha256 ~ '^[a-f0-9]{64}$')
 );
