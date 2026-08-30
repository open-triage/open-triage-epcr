create extension if not exists pgcrypto;

create table public.form_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version text not null,
  locale text not null default 'en',
  definition jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (slug, version, locale)
);

create table public.patient_care_reports (
  id uuid primary key default gen_random_uuid(),
  form_definition_id uuid not null references public.form_definitions(id),
  status text not null default 'draft' check (status in ('draft', 'complete', 'locked')),
  revision integer not null default 1,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.form_definitions enable row level security;
alter table public.patient_care_reports enable row level security;

create policy "authenticated users can read published forms"
on public.form_definitions for select to authenticated
using (published_at is not null);

create policy "users can read their own reports"
on public.patient_care_reports for select to authenticated
using (created_by = auth.uid());

create policy "users can create their own reports"
on public.patient_care_reports for insert to authenticated
with check (created_by = auth.uid());

create policy "users can update their own unlocked reports"
on public.patient_care_reports for update to authenticated
using (created_by = auth.uid() and status <> 'locked')
with check (created_by = auth.uid());
