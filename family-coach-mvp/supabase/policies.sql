
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

create policy "profiles_select_own" on public.profiles for select using ( auth.uid() = id );
create policy "profiles_upsert_own" on public.profiles for insert with check ( auth.uid() = id );
create policy "profiles_update_own" on public.profiles for update using ( auth.uid() = id );

create policy "families_select_member_or_owner" on public.families for select using (
  owner_user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.family_id = id)
);
create policy "families_insert_owner_is_self" on public.families for insert with check ( owner_user_id = auth.uid() );
create policy "families_update_owner_only" on public.families for update using ( owner_user_id = auth.uid() );

create policy "family_members_select_same_family" on public.family_members for select using (
  user_id = auth.uid() 
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.family_id = family_members.family_id)
);
create policy "family_members_insert_self" on public.family_members for insert with check ( user_id = auth.uid() );

create policy "recipes_read_all" on public.recipes for select using ( auth.role() = 'authenticated' );

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


-- Enable RLS
alter table public.calendar_events enable row level security;
alter table public.event_attendees enable row level security;
alter table public.grocery_items enable row level security;
alter table public.grocery_sessions enable row level security;
alter table public.grocery_purchases enable row level security;

-- Calendar policies: family members can CRUD within their family
create policy "calendar_events_family_read" on public.calendar_events for select using (
  exists (select 1 from public.family_members m where m.family_id = calendar_events.family_id and m.user_id = auth.uid())
);
create policy "calendar_events_family_insert" on public.calendar_events for insert with check (
  exists (select 1 from public.family_members m where m.family_id = family_id and m.user_id = auth.uid())
);
create policy "calendar_events_family_update" on public.calendar_events for update using (
  exists (select 1 from public.family_members m where m.family_id = calendar_events.family_id and m.user_id = auth.uid())
);
create policy "calendar_events_family_delete" on public.calendar_events for delete using (
  exists (select 1 from public.family_members m where m.family_id = calendar_events.family_id and m.user_id = auth.uid())
);

create policy "event_attendees_family_rw" on public.event_attendees for all using (
  exists (
    select 1 from public.calendar_events e
    join public.family_members m on m.family_id = e.family_id
    where e.id = event_attendees.event_id and m.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from public.calendar_events e
    join public.family_members m on m.family_id = e.family_id
    where e.id = event_attendees.event_id and m.user_id = auth.uid()
  )
);

-- Grocery policies: family members can CRUD within their family
create policy "grocery_items_family_read" on public.grocery_items for select using (
  exists (select 1 from public.family_members m where m.family_id = grocery_items.family_id and m.user_id = auth.uid())
);
create policy "grocery_items_family_cud" on public.grocery_items for all using (
  exists (select 1 from public.family_members m where m.family_id = grocery_items.family_id and m.user_id = auth.uid())
) with check (
  exists (select 1 from public.family_members m where m.family_id = family_id and m.user_id = auth.uid())
);

create policy "grocery_sessions_family_rw" on public.grocery_sessions for all using (
  exists (select 1 from public.family_members m where m.family_id = grocery_sessions.family_id and m.user_id = auth.uid())
) with check (
  exists (select 1 from public.family_members m where m.family_id = family_id and m.user_id = auth.uid())
);

create policy "grocery_purchases_family_rw" on public.grocery_purchases for all using (
  exists (select 1 from public.family_members m where m.family_id = grocery_purchases.family_id and m.user_id = auth.uid())
) with check (
  exists (select 1 from public.family_members m where m.family_id = family_id and m.user_id = auth.uid())
);


create policy "family_members_manage_owner_manager" on public.family_members
for update using (
  exists (select 1 from public.families f where f.id = family_members.family_id and f.owner_user_id = auth.uid())
  or exists (select 1 from public.family_members fm where fm.family_id = family_members.family_id and fm.user_id = auth.uid() and fm.can_manage_members = true)
) with check (
  exists (select 1 from public.families f where f.id = family_members.family_id and f.owner_user_id = auth.uid())
  or exists (select 1 from public.family_members fm where fm.family_id = family_members.family_id and fm.user_id = auth.uid() and fm.can_manage_members = true)
);

create policy "family_members_delete_owner_manager" on public.family_members
for delete using (
  exists (select 1 from public.families f where f.id = family_members.family_id and f.owner_user_id = auth.uid())
  or exists (select 1 from public.family_members fm where fm.family_id = family_members.family_id and fm.user_id = auth.uid() and fm.can_manage_members = true)
);


-- Dependents RLS
alter table public.dependents enable row level security;
create policy "dependents_family_rw" on public.dependents for all using (
  exists (select 1 from public.family_members m where m.family_id = dependents.family_id and m.user_id = auth.uid())
) with check (
  exists (select 1 from public.family_members m where m.family_id = family_id and m.user_id = auth.uid())
);
