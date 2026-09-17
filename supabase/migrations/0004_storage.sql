-- private bucket for recipe photos; object path convention is '<recipeId>/<uuid>'
insert into storage.buckets (id, name, public)
values ('recipe-photos', 'recipe-photos', false)
on conflict (id) do nothing;

-- storage.objects already has RLS enabled by Supabase; only add policies here.
-- the recipe id is the first folder segment of the object name.
create policy recipe_photos_read on storage.objects for select using (
  bucket_id = 'recipe-photos'
  and can_read_recipe(((storage.foldername(name))[1])::uuid));

create policy recipe_photos_insert on storage.objects for insert with check (
  bucket_id = 'recipe-photos'
  and exists (select 1 from recipes r
    where r.id = ((storage.foldername(name))[1])::uuid and r.author_id = auth.uid()));

create policy recipe_photos_delete on storage.objects for delete using (
  bucket_id = 'recipe-photos'
  and exists (select 1 from recipes r
    where r.id = ((storage.foldername(name))[1])::uuid and r.author_id = auth.uid()));
