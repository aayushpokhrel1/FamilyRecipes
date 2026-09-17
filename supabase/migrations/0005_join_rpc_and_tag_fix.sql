-- Fix 1: joining a family by invite code cannot work through RLS, because a
-- non-member cannot select the family row (families_member_read requires
-- membership). Expose a SECURITY DEFINER RPC that looks up the family by code
-- and adds the caller as a member, bypassing RLS in a controlled way.
create function join_family_by_code(p_code text) returns families
language plpgsql security definer set search_path = public as $$
declare
  fam families;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to join a family';
  end if;
  select * into fam from families where invite_code = p_code;
  if fam.id is null then
    raise exception 'invalid invite code';
  end if;
  insert into family_members (family_id, user_id, role)
    values (fam.id, auth.uid(), 'member')
    on conflict (family_id, user_id) do nothing;
  return fam;
end; $$;

-- Fix 2: recipe_tags write policy was too permissive. can_read_recipe() is true
-- for any public recipe, so any signed-in user could retag other people's public
-- recipes. Restrict writes to the recipe's author or a family owner, matching the
-- ingredient/step write policies.
drop policy rtags_write on recipe_tags;
create policy rtags_write on recipe_tags for all using (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id = r.family_id
      and m.user_id = auth.uid() and m.role = 'owner'))))
  with check (
  exists (select 1 from recipes r where r.id = recipe_id and (r.author_id = auth.uid()
    or exists (select 1 from family_members m where m.family_id = r.family_id
      and m.user_id = auth.uid() and m.role = 'owner'))));
