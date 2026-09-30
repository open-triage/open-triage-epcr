-- Custom coded values retain the same stable custom element identity as scalar extensions.
alter table forms.custom_element_definition
  drop constraint custom_element_definition_base_datatype_check;
alter table forms.custom_element_definition
  add constraint custom_element_definition_base_datatype_check
  check (base_datatype in ('string', 'integer', 'decimal', 'boolean', 'date', 'dateTime',
    'time', 'duration', 'binary', 'anyURI', 'coded'));
