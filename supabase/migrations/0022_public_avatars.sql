-- 0022: a published cook's avatar has to be readable by the anonymous role, because the
-- Worker route that serves it holds only the anon key. Giving the Worker a service key
-- instead would hand the edge a credential that bypasses every policy in this schema, which
-- worker/index.ts deliberately avoids ("the anon key is the whole security model here").
--
-- 0015 made this bucket private on the grounds that "a public object URL is readable by
-- anyone who ever sees it, forever, outside RLS". That reasoning is untouched here: the
-- bucket stays private, every URL is still signed and short-lived, and unpublishing (clearing
-- the handle) revokes access immediately, because the policy is evaluated per request.

-- SECURITY DEFINER, and that is the whole reason this function exists rather than being an
-- inline subquery in the policy below. A subquery inside an RLS policy runs as the CALLER, so
-- reading profiles from it is subject to profiles' own RLS, and anon has no policy on profiles
-- at all. The inline version was written first and the policy was therefore false for every
-- anonymous request, which reads as "Object not found" and looks exactly like a missing file.
-- This is the same reason can_read_recipe and is_family_member are definer functions.
create function is_published_cook(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = uid and p.handle is not null);
$$;

create policy avatars_public_read on storage.objects for select using (
  bucket_id = 'avatars'
  and is_published_cook(((storage.foldername(name))[1])::uuid));
