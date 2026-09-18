-- The API login inherits only this capability role for protected offline
-- storage. The role exposes audited functions, not recovery tables or DDL.
grant open_triage_offline_runtime to open_triage_api_runtime;
