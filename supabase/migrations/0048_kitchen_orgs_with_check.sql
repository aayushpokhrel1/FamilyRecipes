-- 0048: the one kitchen-side policy caught by the `with check` lock added in 0047.
--
-- Separate from 0047 on purpose. That migration repairs the family schema, this one repairs
-- the kitchen schema, and neither names the other: supabase/kitchen_seal.test.ts allows
-- exactly two bridge files to mention both, and a security fix is not a reason to make it
-- three. Two files is the cost of keeping the seal honest, and it is a low price.
--
-- orgs_owner_update is not exploitable as written, because `kitchen.staff_role(id)` is
-- evaluated against the new row too and `id` is the primary key, so there is no way to
-- rewrite your way into another org. It is restated because the audit on 2026-10-12 found
-- that three of the five policies with this exact shape HAD become exploitable the moment a
-- column was added to their table, and the only reliable difference between the safe ones
-- and the unsafe ones was that nobody had looked recently. See 0047's header for the rule.
drop policy orgs_owner_update on kitchen.orgs;
create policy orgs_owner_update on kitchen.orgs for update
  using (kitchen.staff_role(id) = 'owner')
  with check (kitchen.staff_role(id) = 'owner');
