-- 0037: a cook who signs in with Google is called by their name, not "Cook".
--
-- WHAT WAS WRONG. handle_new_user (0001) read exactly one key:
--
--   coalesce(new.raw_user_meta_data->>'display_name', 'Cook')
--
-- and `display_name` is set by ONE caller: the app's own email signup, which passes it in
-- options.data (src/lib/api/auth.ts). An OAuth provider never sets that key. Google writes
-- `name` and `full_name` into the same metadata, so every Google cook fell through to the
-- literal 'Cook' and appeared that way to their own family and in the moderator roster, with
-- their email beside it as the only clue to who they were.
--
-- It also followed them around: kitchen_name() in 0032 turns a display_name of 'Cook' into
-- "My kitchen", so their household got the anonymous name too.
--
-- ANY NEW SIGN-IN METHOD HAS TO BE CHECKED AGAINST THIS LIST. The keys below are what a
-- provider actually sends, and a provider that uses a different one lands on 'Cook' again,
-- silently, exactly as Google did. The order is deliberate: the app's own key wins, because
-- it is the only one the person typed themselves.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      -- what the person typed into this app's signup form
      nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
      -- what Google, Apple and most OIDC providers send
      nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      'Cook'
    )
  );
  return new;
end; $$;

-- THE AVATAR IS DELIBERATELY NOT COPIED, and this is not an oversight to fix later.
-- profiles.avatar_url holds a PATH INSIDE THE `avatars` STORAGE BUCKET, which getAvatarUrl
-- feeds to createSignedUrl. Google sends `picture` and `avatar_url` as absolute https URLs.
-- Writing one of those into this column would be a string that type-checks, passes every
-- test, and then fails at signing time for that cook only. If a Google picture is ever wanted
-- it has to be FETCHED and uploaded into the bucket, which is a job for application code with
-- network access, not for a database trigger.

-- The backfill, for the cooks who already signed in with Google and are sitting there called
-- "Cook". The function above only helps the NEXT person to sign up.
--
-- Scoped three ways on purpose:
--   - only rows still at the literal default 'Cook', so a name anyone has since edited is
--     never overwritten;
--   - only where the provider actually sent a name, so nobody is renamed to blank;
--   - and NOT 'A former member', which is the marker the delete flow writes (0014) and must
--     survive, since that row exists precisely to carry no identity.
update profiles p
   set display_name = n.name
  from (
    select u.id,
           coalesce(
             nullif(btrim(u.raw_user_meta_data->>'display_name'), ''),
             nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
             nullif(btrim(u.raw_user_meta_data->>'name'), '')
           ) as name
      from auth.users u
  ) n
 where p.id = n.id
   and n.name is not null
   and p.display_name = 'Cook';

-- Their HOUSEHOLD is deliberately left alone. kitchen_name('Cook') is "My kitchen", which is
-- a perfectly good name that the owner may well have kept on purpose, and renaming someone's
-- family out from under them to "<Name>'s kitchen" is a bigger liberty than fixing a label
-- they never chose. A cook who wants it renamed can rename it.
