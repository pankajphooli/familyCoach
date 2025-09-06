-- Ensure uuid
create extension if not exists pgcrypto;

-- Dependents (kids)
create table if not exists public.dependents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  dob date,
  color text,
  created_at timestamptz not null default now()
);

-- Exercises (for workout descriptions/images)
create table if not exists public.exercises (
  name text primary key,
  description text,
  image_url text
);

-- Error logs
create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  family_id uuid,
  path text,
  message text,
  stack text,
  context jsonb
);

-- Event attendees can be a member or a kid
do $$ begin
  alter table public.event_attendees alter column user_id drop not null;
exception when undefined_column then null; end $$;

alter table public.event_attendees
  add column if not exists dependent_id uuid references public.dependents(id) on delete cascade;

do $$ begin
  alter table public.event_attendees
    add constraint event_attendee_who_check check (user_id is not null or dependent_id is not null);
exception when duplicate_object then null; end $$;
