-- Versioned selection metadata for immutable catalog code values.

create table catalog.value_set_option_configuration (
  release_id uuid not null,
  value_set_id text not null,
  code_system text not null default '',
  code text not null,
  enabled boolean not null default true,
  sort_order integer not null check (sort_order >= 0),
  is_default boolean not null default false,
  primary key (release_id, value_set_id, code_system, code),
  foreign key (release_id, value_set_id, code_system, code)
    references catalog.value_set_option(release_id, value_set_id, code_system, code)
    on delete cascade
);

create unique index catalog_value_set_option_order_unique
  on catalog.value_set_option_configuration (release_id, value_set_id, sort_order);

create unique index catalog_value_set_option_one_default
  on catalog.value_set_option_configuration (release_id, value_set_id)
  where is_default;

create trigger catalog_value_set_option_configuration_immutable
before insert or update or delete on catalog.value_set_option_configuration
for each row execute function catalog.prevent_sealed_projection_mutation();

revoke all on table catalog.value_set_option_configuration from public;
grant select on table catalog.value_set_option_configuration to open_triage_projector;
