# The professional kitchen: a separate app on a shared spine

**Decided 2026-10-11.** This is the design for the first professional-kitchen slice. It is the
product Aayush expects to be the big one, and it is deliberately NOT built into the family app.

## The brief, and which parts of it are hypothesis

There is **no customer yet**. Nothing has arrived through the landing page's `mailto:`, so every
statement about what a kitchen wants is a hypothesis, and the ones below are flagged as such so a
later session can tell them from the decisions.

- **Hypothesised customer: a multi-site group**, two to ten sites sharing a central recipe
  standard that each site executes. Chosen over an independent restaurant, a small food producer
  and a caterer, with eyes open: it carries the heaviest permission model of the four.
- **Hypothesised job it is bought for: there is one answer to "what is the current version of
  this dish and who approved it".** Today that answer is spread across a notebook, a WhatsApp
  thread and a Google Doc that one site printed six weeks ago.
- **Decided, not hypothesised:** the first slice is the development-to-rollout pipeline. Cost and
  margin control is next in the roadmap, and the model must be able to grow it without rework.
- **Decided:** crossover is one way. A group may publish a finished dish out to Potluck with the
  venue as the byline. Nothing is ever imported in. One login holds both kinds of membership.

### The story the first slice has to tell

1. A chef writes a dish up once, in development. Only owners and chefs can see it. Each revision
   is kept, with who changed it and why.
2. The chef sends it to one site to trial. That site's staff can read and cook it.
3. On success the chef signs it off onto the group menu, dated, against one version.
4. A site that has to change something records a deviation against the group version rather than
   replacing it, so the chef can see that one site is cooking it differently.
5. Optionally the owner publishes the finished dish publicly as marketing, with the restaurant's
   name under it rather than a person's.

## Architecture: approach B, a separate app on a shared spine

Three approaches were weighed. **A**, a typed workspace where a site is a `families` row with the
group layered above, reuses the most and ships soonest, at the cost of family and kitchen data
sharing one drawer forever. **C**, a separate repo and Supabase project, is the cleanest
commercially but loses the single login and the publish-out, both of which were chosen. **B was
chosen**: family rules and kitchen rules can never leak into each other, and the pro schema can
move fast without migrating family tables.

B's commonly quoted cost, rebuilding the editor, is mostly not real here, and the measurement is
worth keeping: `IngredientEditor` takes `items` and `onChange` and nothing else, and nothing
outside `src/lib/api/` imports the Supabase client at all. The presentational components and the
pure helpers transfer as they are. **B's real cost is a second data layer and a second set of
pages.**

### The seam

- Same repo, same Worker, same Supabase project, same `auth.users`, so **one login**.
- A new host, `kitchen.enamelvault.com`, routed by hostname in the Worker exactly as the landing
  page already is.
- **Sealed data.** A new Postgres schema, `kitchen`, with its own tables, its own RLS and its own
  membership helper `kitchen.is_staff(org_id)`. Nothing in `kitchen` references `public.families`,
  `public.recipes` or `public.profiles`, and nothing in `public` references `kitchen`, with the
  single exception of the publish bridge below. A chef's professional name lives on their staff
  row rather than being borrowed from `profiles`, so the schemas stay independent.
- **Shared code, deliberately**: the design tokens (one `index.css`, so the contrast test keeps
  covering both surfaces), the presentational components, the pure helpers in `src/lib/`, and the
  auth plumbing. **One rule keeps this from rotting: a shared component may never gain a
  kitchen-only prop.** If it has to diverge it forks, and the fork belongs to the kitchen app.
- Data access lives in `src/lib/api/kitchen/`, which keeps the project rule that only
  `src/lib/api/` touches Supabase.
- **The app itself is a second Vite entry in this repo**: `kitchen.html` at the root, booting
  `src/kitchen/`, built by the same `npm run build` and served by the same Worker. **Under
  `src/`, not a top-level `kitchen/`, because `npm test` runs `vitest run src supabase worker
  scripts`**: a test outside those four directories never runs at all, and a directory of
  silently skipped tests is the exact failure class this project keeps paying for. The HTML
  entry is at the root rather than in `public/` because it must be BUILT; `public/` is copied
  verbatim and would ship an entry pointing at an unbuilt module.

### Getting staff into an org

An owner creates the org, names its sites, and invites staff **by link**, which is the mechanism
the family app already paid to get right. The link names the org and the role before anyone signs
in, asks before it joins (a forwarded link must not make someone a chef by itself), and survives
signing up.

**The destination travels in the URL, never in router state, and goes through `safeNext`.** That
rule is not optional and not re-litigated here: it was learned twice on this project in one week,
once when the family invite lost its destination on three of the four ways in, and again when the
fix lost it inside an async callback. `src/lib/nextPath.ts` stays the single place that builds and
validates it, and it is shared code, not forked.

## The data model

In schema `kitchen`: `orgs`, `sites`, `staff`, `staff_invites`, `dishes`, `dish_versions`,
`dish_ingredients`, `dish_steps`, `approvals`, `deviations`, `published_snapshots`.

- `staff` carries `role` in (`owner`, `chef`, `site_manager`, `cook`), a `display_name`, and a
  nullable `site_id` where **null means group-wide**.
- **A version is immutable.** Ingredients and steps hang off `dish_versions`, not off `dishes`.
  Revising writes a new version with a note. This is what makes "who changed what and why" a
  query rather than a hope, and it is the thing the Google Doc cannot do.
- **Stage lives on the dish, sign-off lives on the version.** `dishes.stage` is
  `development | trial | menu`, with `trial_site_id` set while it is out at one site. Sign-off is
  a row in `approvals` against a version. "What is on the menu" is therefore: stage is `menu`,
  and the live version is the latest approved one. **If stage lived on versions that question
  could not be answered, and if sign-off lived on the dish you could not tell which version was
  approved.**

### The kitchen's read ladder, which is NOT the family ladder

| Stage | Who can read it |
| --- | --- |
| `development` | owners and chefs only |
| `trial` | plus staff of the trial site |
| `menu` | every staff member of the org |

The family app's `private / family / public` enum is untouched and gains nothing. Adding `trial`
to `recipe_visibility` would put an option in `VisibilitySelect` that every family would have to
be taught to ignore, which is the trap `PRODUCT.md` names.

### Who may do what

| | development | send to trial | record a deviation | sign off onto menu | publish out |
| --- | --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes | yes |
| chef | yes | yes | yes | yes | no |
| site_manager | no | no | own site only | no | no |
| cook | no | no | no | no | no |

**Publishing is the owner's alone**, because it is a marketing act with a legal surface rather
than a kitchen act. A chef signs dishes onto the menu but does not speak publicly for the
business.

Two edges, decided now rather than discovered later:

- **A dish at trial can be revised**, and the trial site sees the new version. Freezing on trial
  would stop a chef responding to the notes coming back, which is the point of a trial.
- **Sign-off approves ONE version.** If the dish is revised after sign-off, the dish stays on the
  menu with the previously approved version live and the new version unapproved. The menu never
  silently changes under three sites because someone typed in an editor.

## The publish-out bridge

One function crosses the seal: `kitchen.publish_dish(version_id)`, `security definer`, callable
by an org owner only.

A published dish becomes a **snapshot copy**: a real `public.recipes` row at `visibility =
'public'` with its ingredient and step children, hanging off a `public.families` row named after
the venue, created lazily on first publish, **with no members at all**.

That members-free family row is the mechanism, and it is free because of rules that already
exist. `recipes_insert` requires `is_family_member`, so nothing but the definer bridge can ever
put a recipe in it. `families_member_read` requires membership, so nobody can read it directly.
But `public_recipe_bylines` reads the family name through a view that bypasses RLS on purpose,
and its left join on `profiles` renders the family name alone when there is no handle, which that
view's own comment states is intended. So **the venue gets its name under the dish with no
person's handle attached, and the kitchen never becomes a usable family anywhere.**

Three properties, recorded so they are not later mistaken for bugs:

- **Publishing is a copy, so later menu revisions do not silently change the public page.**
  Re-publishing updates the same snapshot row, so the public URL survives, which is the point of
  having a link to send.
- **A published dish sits inside Potluck's moderation regime like anything else.**
  `enforce_publish_rules` fires on the bridge's insert too, so a takedown sticks and a removed
  dish cannot be republished. The snapshot's `author_id` is the person who pressed publish, so
  their suspension blocks it.
- **Unpublish sets the snapshot to `family` visibility**, which on a family with no members
  means nobody at all can read it. The snapshot ROW survives, because it holds the recipe id
  and re-publishing must reuse the same public URL, so a takedown is recorded as
  `unpublished_at` on that row (added in `0045`). "Is it public" is therefore that column
  being null, never the row existing: treating the row as proof shipped a page that still
  claimed a taken-down dish was published.

The seal is therefore honest but qualified, and the qualification is the publish functions
plus the `kitchen.published_snapshots` mapping with its foreign key to `public.recipes`.

**It began as one migration and is now two.** `0045` had to replace `unpublish_dish`, and
replacing a function means restating its update of `public.recipes`. So the rule is not "one
file" but **a named inventory**: `supabase/kitchen_seal.test.ts` lists every bridge migration
and fails for any other file that reaches across. Adding to that list is a deliberate act
with its reason written in the migration itself.

## The mechanical defences

**Task one of the implementation, before any kitchen table exists**, is a landmine found while
writing this spec. `supabase/rls.test.ts`, the test that holds the entire security model,
contains:

    // A table in another schema is not ours to police.
    if (name.includes(".") && !name.startsWith("public.")) continue;

Approach B creates **every** table in another schema, so the guard would silently stop covering
the new product on day one: a `kitchen.dishes` with no RLS would ship with the suite green. Teach
the guard the `kitchen` schema and **watch it go red against a deliberately unpoliced table
before writing a real one.**

- **The seal, as a test.** No file under the kitchen app imports a family `src/lib/api/` module,
  nothing under `src/lib/api/kitchen/` is imported by the family app, and `kitchen.` appears in
  exactly one migration outside the kitchen's own. A grep test, because the seal is the entire
  justification for choosing B over A.
- **Integration tests for the stage ladder per role.** A cook at site two reading a dish in
  development is the bug that kills this product with its first customer.
- **`src/lib/browserStorage.test.ts` will fail** the moment the kitchen app stores its first key.
  That is the mechanism working: extend its allowed list deliberately, per key, with the reason.
- **A browser walk as all four roles before this is called done.** Eight defects on this project
  have shipped past a green suite, a clean typecheck and a review. Four roles times three stages
  will not be verified by unit tests.

## Consequences elsewhere

- **`PRODUCT.md` is now wrong and must be corrected where it sits, not appended to.** It says the
  public feed "almost certainly is not" reusable. One-way publish-out means it is.
- **The new host needs the Worker treatment, not just a route**: hostname branching, `noindex`
  until there is a product (the landing page's "in development" claim has to stay true), no
  inline scripts under the existing CSP, and its own mark and meta.
- **Money changes the legal surface, so the first slice ships with no payments.** Terms, a refund
  position, liability for allergen and cost data, and someone else's trade secrets in the vault
  all arrive with the first invoice. That is the gate on charging, which keeps the known `/terms`
  gaps from becoming urgent before they are.

## Roadmap after this slice, in order

1. **Costs**: yield, portion cost, supplier, allergen data, in their own sidecar table so nothing
   above changes.
2. **Stale-copy and consistency reporting** across sites.
3. **Dated allergen records**, which is where the liability is.
4. **Photos** for dishes.
5. **Stations and prep lists.**

## Explicitly out of scope for this slice

Photos, costs, stations, prep lists, payments, anything a cook does on a phone during service,
and any import from the family side.
