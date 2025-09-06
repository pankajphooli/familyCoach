
create extension if not exists pgcrypto;

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null,
  invite_code text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key,
  family_id uuid references public.families(id) on delete set null,
  full_name text,
  sex text,
  dob date,
  height_cm int,
  weight_kg numeric,
  target_weight_kg numeric,
  target_date date,
  activity_level text,
  dietary_pattern text,
  allergies jsonb default '[]'::jsonb,
  dislikes text,
  cuisines jsonb default '[]'::jsonb,
  budget_level text,
  meals_per_day int,
  fasting_window text,
  primary_goal text,
  secondary_goal text,
  equipment jsonb,
  knee_back_flags jsonb,
  injuries jsonb default '[]'::jsonb,
  step_goal int,
  sleep_hours int,
  time_per_workout_min int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  tags text,
  allergens text,
  cuisine text,
  ingredients text,
  steps text
);

create table if not exists public.plan_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  total_kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  notes text
);

create table if not exists public.plan_meals (
  id uuid primary key default gen_random_uuid(),
  plan_day_id uuid not null references public.plan_days(id) on delete cascade,
  meal_type text not null,
  recipe_name text not null,
  kcal numeric,
  macros jsonb,
  substitutions jsonb
);

create table if not exists public.workout_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  goal text,
  duration_min int,
  intensity text,
  notes text
);

create table if not exists public.workout_blocks (
  id uuid primary key default gen_random_uuid(),
  workout_day_id uuid not null references public.workout_days(id) on delete cascade,
  type text,
  movements jsonb,
  sets int,
  reps int,
  rpe int,
  substitutions jsonb
);

create table if not exists public.logs_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  meal_type text,
  compliance_pct int,
  notes text
);

create table if not exists public.logs_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  completed boolean,
  pain_flags jsonb,
  rpe int,
  notes text
);

create table if not exists public.logs_biometrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  date date not null,
  weight_kg numeric,
  waist_cm numeric,
  sleep_hours numeric,
  steps int,
  hr_resting int
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);


-- Calendar events
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  description text,
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  all_day boolean not null default false,
  recurrence jsonb, -- e.g. {"type":"WEEKLY","interval":1,"byweekday":["MO","WE"],"until":null}
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.event_attendees (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null
);

-- Grocery
create table if not exists public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  qty text,
  unit text,
  is_checked boolean not null default false,
  added_by uuid,
  last_added_at timestamptz not null default now(),
  freq_count int not null default 1
);

create table if not exists public.grocery_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid
);

create table if not exists public.grocery_purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  session_id uuid references public.grocery_sessions(id) on delete set null,
  name text not null,
  qty text,
  unit text,
  purchased_at timestamptz not null default now(),
  purchased_by uuid
);
