
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.plan_days enable row level security;
alter table public.plan_meals enable row level security;
alter table public.workout_days enable row level security;
alter table public.workout_blocks enable row level security;
alter table public.logs_meals enable row level security;
alter table public.logs_workouts enable row level security;
alter table public.logs_biometrics enable row level security;
alter table public.audit_events enable row level security;

-- Profiles: only the owner can see/update/insert their row
create policy "profiles_select_own" on public.profiles for select using ( auth.uid() = id );
create policy "profiles_upsert_own" on public.profiles for insert with check ( auth.uid() = id );
create policy "profiles_update_own" on public.profiles for update using ( auth.uid() = id );

-- Families: owner or members can select; only owner can update; authenticated can create with themselves as owner
create policy "families_select_member_or_owner" on public.families for select using (
  owner_user_id = auth.uid() or exists (select 1 from public.family_members m where m.family_id = id and m.user_id = auth.uid())
);
create policy "families_insert_owner_is_self" on public.families for insert with check ( owner_user_id = auth.uid() );
create policy "families_update_owner_only" on public.families for update using ( owner_user_id = auth.uid() );

-- Family members: user can see memberships in their families; user can insert themselves
create policy "family_members_select_related" on public.family_members for select using (
  user_id = auth.uid() or exists (select 1 from public.families f where f.id = family_id and (f.owner_user_id = auth.uid()))
);
create policy "family_members_insert_self" on public.family_members for insert with check ( user_id = auth.uid() );

-- Recipes: read-only to everyone authed
create policy "recipes_read_all" on public.recipes for select using ( auth.role() = 'authenticated' );

-- Plan/Workout/Logs: owner-only access
create policy "plan_days_rw_own" on public.plan_days for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
create policy "plan_meals_rw_via_day" on public.plan_meals for all using (
  exists (select 1 from public.plan_days d where d.id = plan_day_id and d.user_id = auth.uid())
) with check (
  exists (select 1 from public.plan_days d where d.id = plan_day_id and d.user_id = auth.uid())
);

create policy "workout_days_rw_own" on public.workout_days for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
create policy "workout_blocks_rw_via_day" on public.workout_blocks for all using (
  exists (select 1 from public.workout_days d where d.id = workout_day_id and d.user_id = auth.uid())
) with check (
  exists (select 1 from public.workout_days d where d.id = workout_day_id and d.user_id = auth.uid())
);

create policy "logs_meals_rw_own" on public.logs_meals for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
create policy "logs_workouts_rw_own" on public.logs_workouts for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );
create policy "logs_biometrics_rw_own" on public.logs_biometrics for all using ( user_id = auth.uid() ) with check ( user_id = auth.uid() );

create policy "audit_events_owner_read" on public.audit_events for select using ( user_id = auth.uid() );
create policy "audit_events_owner_insert" on public.audit_events for insert with check ( user_id = auth.uid() );
