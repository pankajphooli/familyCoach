
-- Enable extensions (uuid comes from pgcrypto via gen_random_uuid)
create extension if not exists pgcrypto;

-- Families
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null,
  invite_code text unique,
  created_at timestamptz not null default now()
);

-- Family members
create table if not exists public.family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member',
  created_at timestamptz not null default now()
);

-- Profiles
create table if not exists public.profiles (
  id uuid primary key, -- = auth.users.id
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
  step_goal int,
  sleep_hours int,
  time_per_workout_min int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Recipes (simplified)
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

-- Plan days + meals
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

-- Workout days + blocks
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

-- Logs
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

-- Audit
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  target text,
  meta jsonb,
  created_at timestamptz not null default now()
);
