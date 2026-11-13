-- Existing codes retain their original client-name contract. New codes snapshot
-- the administrator's selected name, independently of the consuming client.
alter table app_identity.unit_enrollment
 add column installation_name text
 check (installation_name is null or
   (length(installation_name) between 1 and 100 and installation_name = btrim(installation_name)
    and installation_name !~ '[[:cntrl:]]'));
