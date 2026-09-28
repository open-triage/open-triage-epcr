drop table if exists forms.form_locale;

alter table forms.form_section
  drop column if exists presentation;

alter table forms.form_field
  drop column if exists configuration;
