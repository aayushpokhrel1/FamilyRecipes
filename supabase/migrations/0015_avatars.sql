-- 0015: a private bucket for profile avatars.
--
-- Object path convention is '<userId>/<uuid>', so the owning user is the first
-- folder segment, exactly the way recipe-photos keys off the recipe id.
--
-- Private rather than public, deliberately. A public bucket would be simpler
-- and would save signing every avatar, but this app is a private family vault:
-- a public object URL is readable by anyone who ever sees it, forever, outside
-- any of the membership rules the rest of the app enforces. An avatar is a
-- photograph of a person, so it gets the same treatment as a recipe photo.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- Read scope mirrors profiles_self_read: yourself, plus anyone you share a
-- family with. Keeping the two in step matters, because seeing a name without
-- the face next to it (or the reverse) would be an odd half-visible member.
create policy avatars_read on storage.objects for select using (
  bucket_id = 'avatars'
  and (
    ((storage.foldername(name))[1])::uuid = auth.uid()
    or exists (
      select 1 from family_members fm1
      join family_members fm2 on fm1.family_id = fm2.family_id
      where fm1.user_id = auth.uid()
        and fm2.user_id = ((storage.foldername(name))[1])::uuid)));

-- Only you write your own avatar. Update and delete are separate policies
-- because storage.objects treats a replace as an update, and without it
-- swapping your picture would fail while uploading a first one worked.
create policy avatars_insert on storage.objects for insert with check (
  bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = auth.uid());

create policy avatars_update on storage.objects for update using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = auth.uid());

create policy avatars_delete on storage.objects for delete using (
  bucket_id = 'avatars' and ((storage.foldername(name))[1])::uuid = auth.uid());
