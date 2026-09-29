-- 0030: let a report name a COOK as well as a recipe, and add the remedy for a public name
-- that pretends to be someone else.
--
-- handle is already unique and constrained to ^[a-z0-9_]{3,30}$ by 0020. public_name is free
-- text and always was, which is why the display name, not the handle, is the impersonation
-- vector and the thing this migration can clear.

alter table profiles
  add column name_cleared_at timestamptz,
  add column name_cleared_reason text;

alter table reports
  alter column recipe_id drop not null,
  add column cook_id uuid references profiles(id) on delete cascade,
  add constraint report_has_one_target check (num_nonnulls(recipe_id, cook_id) = 1);

-- The existing reports_one_open_per_reporter index is on (recipe_id, reporter_id) and does
-- NOT cover cook reports: without this sibling, one reporter could flood the queue with cook
-- reports while recipe reports stayed rate limited.
create unique index reports_one_open_cook_per_reporter
  on reports (cook_id, reporter_id) where status = 'open' and cook_id is not null;

-- Restated from 0028 to add one action. Everything else is carried over verbatim.
create or replace function resolve_report(p_report_id uuid, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_recipe uuid;
  v_cook uuid;
  v_author uuid;
begin
  if not is_moderator() then
    raise exception 'not a moderator' using errcode = 'insufficient_privilege';
  end if;
  if p_action not in ('unpublish', 'suspend', 'dismiss', 'clear_name') then
    raise exception 'unknown action %', p_action using errcode = 'check_violation';
  end if;

  select r.recipe_id, r.cook_id into v_recipe, v_cook
  from reports r where r.id = p_report_id;
  if v_recipe is null and v_cook is null then
    raise exception 'no such report' using errcode = 'no_data_found';
  end if;

  -- The cook to act on: the reported cook, or the reported recipe's author.
  v_author := coalesce(v_cook, (select rec.author_id from recipes rec where rec.id = v_recipe));

  if p_action = 'unpublish' then
    update recipes set visibility = 'family', removed_at = now(), removed_reason = p_reason
    where id = v_recipe;
  elsif p_action = 'suspend' then
    update profiles set suspended_at = now(), suspended_reason = p_reason where id = v_author;
    -- Suspension takes their existing public recipes down too. A cook who may not publish
    -- but whose published recipes stay up is not suspended in any sense a reader would
    -- recognise.
    update recipes set visibility = 'family', removed_at = now(), removed_reason = p_reason
    where author_id = v_author and visibility = 'public';
  elsif p_action = 'clear_name' then
    -- The HANDLE is deliberately untouched. It is the identity in every /cooks/<handle> URL,
    -- so releasing it would break every existing link to that cook, including links their own
    -- family holds. The display name is the lie, not the handle.
    update profiles
       set public_name = null, name_cleared_at = now(), name_cleared_reason = p_reason
     where id = v_author;
  end if;

  update reports
     set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
         resolved_at = now(), resolved_by = auth.uid()
   where id = p_report_id;
end; $$;
