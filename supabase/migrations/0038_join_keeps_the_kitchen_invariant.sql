-- 0038: joining a family can no longer cost a cook their own kitchen, and the name behind an
-- invite code can be read by the person holding it.

-- THE INVARIANT FROM 0032 WAS ENFORCED BY THE CLIENT'S ORDERING, WHICH IS NOT AN INVARIANT.
--
-- Every cook is supposed to have their own kitchen plus any family they join. The guarantee
-- lived in FamilyContext, which calls ensure_own_kitchen() only when the family list comes
-- back EMPTY, so a cook whose FIRST membership arrives before that check never gets one:
-- `list.length === 0` is false, the branch never runs, and nothing ever tries again.
--
-- Nobody could reach that until now, by luck rather than by design: you had to be inside the
-- app to type an invite code, so the check had always run by then. A join LINK is the thing
-- that breaks the luck, because it joins on the first load of the app, before that check.
-- The result would have been exactly the split this product does not want: a cook who came
-- in by link has no kitchen of their own, a cook who signed up normally does, and which one
-- you are depends on which door you walked through.
--
-- So the guarantee moves into the one function every join goes through, in the same
-- transaction as the membership. Order stops mattering, and a join path added later inherits
-- it without having to know it exists.
--
-- ensure_own_kitchen() RETURNS EARLY IF THE CALLER HAS ANY MEMBERSHIP, so it has to be called
-- BEFORE the insert below, never after. Called after, it would see the family just joined and
-- do nothing, which is the bug this migration exists to remove, reintroduced one line lower.
create or replace function join_family_by_code(p_code text) returns families
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

  -- BEFORE the insert. See the note above.
  perform ensure_own_kitchen();

  insert into family_members (family_id, user_id, role)
    values (fam.id, auth.uid(), 'member')
    on conflict (family_id, user_id) do nothing;
  return fam;
end; $$;

-- What an invite link may say before anyone signs in.
--
-- A link that opens on "Join a family" and nothing else asks a person to accept an invitation
-- they cannot see, so the page names the family. This returns the NAME and nothing else: not
-- the id, not the members, not the recipe count. The caller already holds the invite code,
-- and the code is a bearer credential, so anyone who has it can simply join and read the name
-- anyway. This discloses nothing the code did not already carry; it only saves them from
-- joining blind to find out.
--
-- A wrong or retired code returns NULL rather than raising, because "no such code" is a
-- normal answer the join page renders, not an error. rotate_invite_code is the revocation:
-- rotating retires every link ever sent for that family.
--
-- SECURITY DEFINER because families_member_read refuses the row to a non-member, which is the
-- whole reason join_family_by_code exists too. STABLE, not volatile: it writes nothing.
create or replace function family_name_for_code(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select name from families where invite_code = p_code;
$$;

-- anon as well as authenticated, deliberately and unlike every other grant in this schema:
-- the whole point is the page a SIGNED-OUT person lands on when a link is sent to them.
-- PUBLIC first then the named roles, the same pair as 0032, 0034 and 0035, because Postgres
-- grants execute to PUBLIC on every new function and revoking from one role does not undo it.
revoke execute on function family_name_for_code(text) from public;
grant execute on function family_name_for_code(text) to anon;
grant execute on function family_name_for_code(text) to authenticated;
