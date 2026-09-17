alter table profiles enable row level security;
alter table families enable row level security;
alter table family_members enable row level security;

-- profiles: a user reads their own profile and profiles of co-members
create policy profiles_self_read on profiles for select
  using (id = auth.uid() or exists (
    select 1 from family_members fm1
    join family_members fm2 on fm1.family_id = fm2.family_id
    where fm1.user_id = auth.uid() and fm2.user_id = profiles.id));
create policy profiles_self_update on profiles for update
  using (id = auth.uid());

-- families: members read; any authed user creates
create policy families_member_read on families for select
  using (is_family_member(id));
create policy families_insert on families for insert
  with check (created_by = auth.uid());
create policy families_owner_update on families for update
  using (exists (select 1 from family_members
    where family_id = families.id and user_id = auth.uid() and role = 'owner'));

-- family_members: members of the family read the roster
create policy members_read on family_members for select
  using (is_family_member(family_id));
-- a user may add THEMSELVES (join); creator handled in api by inserting owner row
create policy members_self_insert on family_members for insert
  with check (user_id = auth.uid());
-- owner may remove members; a user may remove themselves
create policy members_delete on family_members for delete
  using (user_id = auth.uid() or exists (select 1 from family_members m
    where m.family_id = family_members.family_id and m.user_id = auth.uid() and m.role='owner'));
