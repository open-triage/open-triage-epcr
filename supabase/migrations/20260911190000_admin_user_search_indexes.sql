-- User administration searches by a literal fragment of the normalized
-- display name or local username. Trigram indexes keep those predicates
-- indexed while the ordered keyset index keeps deep pages bounded.
create extension if not exists pg_trgm;

create index app_user_admin_search_display_name_idx
  on app_identity.app_user using gin (lower(display_name) gin_trgm_ops);

create index local_credential_admin_search_username_idx
  on app_identity.local_credential using gin (username gin_trgm_ops);

create index app_user_admin_listing_idx
  on app_identity.app_user
    (organization_id, (not active), lower(display_name), id)
  include (display_name, active);
