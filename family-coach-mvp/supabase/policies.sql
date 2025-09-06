-- Dependents RLS
alter table public.dependents enable row level security;
do $$ begin
  create policy "dependents_family_rw" on public.dependents
  for all using (
    exists (select 1 from public.family_members m where m.family_id = dependents.family_id and m.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.family_members m where m.family_id = dependents.family_id and m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- Errors RLS
alter table public.app_errors enable row level security;
do $$ begin
  create policy "app_errors_insert" on public.app_errors for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "app_errors_select_owner" on public.app_errors for select using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = app_errors.family_id
        and fm.user_id = auth.uid()
        and (fm.role = 'owner' or fm.can_manage_members = true)
    ) or app_errors.user_id = auth.uid()
  );
exception when duplicate_object then null; end $$;

-- family_members RLS (so members list shows)
alter table public.family_members enable row level security;
do $$ begin
  create policy "family_members_select_same_family" on public.family_members
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.family_id = family_members.family_id
    )
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "family_members_insert_self" on public.family_members
  for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "family_members_update_owner_manager" on public.family_members
  for update using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_members.family_id
        and fm.user_id = auth.uid()
        and (fm.role = 'owner' or fm.can_manage_members = true)
    )
  ) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "family_members_delete_owner_manager" on public.family_members
  for delete using (
    exists (
      select 1 from public.family_members fm
      where fm.family_id = family_members.family_id
        and fm.user_id = auth.uid()
        and (fm.role = 'owner' or fm.can_manage_members = true)
    )
  );
exception when duplicate_object then null; end $$;
