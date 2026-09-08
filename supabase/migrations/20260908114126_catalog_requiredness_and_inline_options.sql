-- Agency validation severity and versioned selection metadata for inline element code lists.

alter table catalog.element_definition
  add column agency_required_severity text
  check (agency_required_severity in ('warning', 'error'));

create table catalog.element_option_configuration (
  release_id uuid not null,
  element_id text not null,
  source_kind text not null default 'inline' check (source_kind = 'inline'),
  code_system text not null default '',
  code text not null,
  enabled boolean not null default true,
  sort_order integer not null check (sort_order >= 0),
  is_default boolean not null default false,
  primary key (release_id, element_id, source_kind, code_system, code),
  foreign key (release_id, element_id, source_kind, code_system, code)
    references catalog.element_option(release_id, element_id, source_kind, code_system, code)
    on delete cascade
);

create unique index catalog_element_option_order_unique
  on catalog.element_option_configuration (release_id, element_id, sort_order);

create unique index catalog_element_option_one_default
  on catalog.element_option_configuration (release_id, element_id)
  where is_default;

create trigger catalog_element_option_configuration_immutable
before insert or update or delete on catalog.element_option_configuration
for each row execute function catalog.prevent_sealed_projection_mutation();

revoke all on table catalog.element_option_configuration from public;
grant select on table catalog.element_option_configuration to open_triage_projector;
