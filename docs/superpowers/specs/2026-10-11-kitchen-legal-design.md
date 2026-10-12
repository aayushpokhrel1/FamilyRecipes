# Terms and privacy for the professional-kitchen host

**Decided 2026-10-11.** The professional-kitchen app has no terms and no privacy page of its
own. This is the design for both documents, for the gate that records acceptance, and for the
footer that makes them reachable at all.

It is a separate spec from `2026-10-11-professional-kitchen-design.md` because it is a separate
legal surface: a different product, different parties, different data, and a different way of
going wrong.

## What was actually missing, which is more than two pages

The session began as "write two pages". Reading the code first turned up three gaps, and the
documents are only the first:

1. **No documents.** The family app's `/terms` and `/privacy` are linked from its footer. The
   kitchen app has neither page nor footer.
2. **No gate.** `src/kitchen/routes.tsx` wires every route through `RequireAuth` and nothing
   through any terms gate, so no kitchen user has ever accepted anything. Every kitchen route
   is an action route: create a group, write a dish, sign a version off, invite staff, record a
   deviation.
3. **No test could see either gap.** `src/routes.terms.test.ts` reads the family `routes.tsx`
   only. The suite was green with a product whose entire surface was ungated.

A fourth gap was found while designing the fix and is closed here too: see **The seal had a
hole**.

## The parties: you personally, your employer's content

**Decided.** The agreement is with the person signing in. The documents say plainly that the
content they enter belongs to the business they work for.

The alternative, that accepting binds the employer, is legally tidier for a business product and
was rejected: nobody signing up to a free product has authority to bind a restaurant group, so
that acceptance would be a claim that is usually false. A recorded acceptance that is probably
untrue is worse than an honest one of narrower scope.

The consequence runs through both documents. The person agrees, and confirms they have their
employer's say-so to put the employer's recipes in. The privacy page then names **two
controllers**: the operator controls the account, the business controls the kitchen content and
its staff records, with the operator acting as the business's processor for that. The family app
needs no such split, which is the clearest single reason these are separate documents rather
than one pair with "if you are a kitchen" branches.

## Where the acceptance record lives

**Decided: kitchen-local, its own table, its own version constant.**

`supabase/kitchen_seal.test.ts` forbids `src/kitchen/**` from importing any `lib/api/` module
except `auth` and `kitchen/*`. `acceptTerms` and `profiles.terms_accepted_at` live in
`lib/api/profile.ts`, so the kitchen cannot reuse the family's mechanism. That constraint is
load-bearing rather than inconvenient: the seal is the entire justification for the kitchen
being a second app.

Two alternatives were weighed. A **product-neutral shared table** with one `lib/api/terms.ts`
allow-listed in the seal gives one mechanism to maintain, and was rejected because a shared
table the kitchen reads is a crossing: it needs the bridge migration and it weakens the claim
the seal exists to make. **No gate at all**, publishing the documents and letting use imply
acceptance, was rejected because the kitchen records sign-offs that staff may later rely on, and
the family side already decided a recorded acceptance is this project's standard. The weaker
form on the business product is backwards.

### `0046_kitchen_terms.sql`

```sql
create table kitchen.terms_acceptance (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  version     text not null,
  accepted_at timestamptz not null default now()
);
```

RLS enabled, with select, insert and update policies all `user_id = auth.uid()`.

**Per user, not per org**, for two reasons that are each sufficient. A person accepts the terms
once, not once per employer. And a brand-new account has no `kitchen.staff` row yet, while
"create a group" is itself an action that must be gated, so an org-keyed record could not gate
the first thing a new user does.

**No `SECURITY DEFINER` function.** The client upserts its own row under RLS. That avoids the
`set search_path` requirement `supabase/rls.test.ts` enforces, and it is no weaker than the
family side, where the version string is also supplied by the client: the record is of what the
client rendered, which is a client-side fact. `rls.test.ts` picks the new table up with no
change, because it reads the migrations rather than a list.

`0046` joins the `0039`-`0045` set that must be applied to cloud **before** any kitchen frontend
deploys. It adds no new manual step to the four in `docs/OPERATIONS.md`.

## The code

- `src/lib/api/kitchen/terms.ts`: read my acceptance, write my acceptance. Two calls. The name
  satisfies the seal's `lib/api/(auth|kitchen/[a-z]+)` allow-list.
- `src/kitchen/components/KitchenTermsGate.tsx`, holding `KITCHEN_TERMS_VERSION`. Same shape as
  the family gate, including the rule that a failed read must not lock anyone out of the app.

**Two version constants, deliberately.** The documents are different products and must be
revisable independently; a shared constant would re-ask every family cook because a kitchen
clause moved.

`src/lib/legal.ts` **is** shared, and gains `KITCHEN_TERMS_UPDATED` and
`KITCHEN_PRIVACY_UPDATED`. `OPERATOR` and `CONTACT_EMAIL` are reused because they are the same
facts: one operator, one mailbox that a human reads. The seal permits this, since `legal.ts` is
not under `lib/api/`. A dedicated `kitchen@` address would read better than `moderation@` on a
business page and is deferred: a new mailbox is a Cloudflare Email Routing change outside the
repo, and `legal.ts` requires the published address to be a live one.

## Routes: three bands, so the gate is structural

```
outside everything            /signin  /signup  /auth/callback
inside KitchenApp, ungated    /terms   /privacy
inside KitchenApp, gated      /join/:code  and all six RequireAuth routes
```

The gated band is one layout route rendering `<KitchenTermsGate><Outlet /></KitchenTermsGate>`,
rather than the wrapper repeated on each route. One wrapper is fewer lines than six and makes
"did somebody add an ungated action route" a structural question a test can ask.

**`/terms` and `/privacy` sit outside the gate** for the reason the family app's four public
documents do: a notice you can only read after consenting is not a notice. They stay inside the
layout so they keep the header and footer.

**`/join/:code` is public but gated**, because joining an employer's group is an action. This is
not a new judgement; it is the family app's, which it learned by shipping the opposite and
catching it in a browser.

## The footer

`src/kitchen/components/KitchenFooter.tsx`, rendered from `src/kitchen/main.tsx` outside the
router, with the `.site` wrapper moved up from `KitchenApp` to sit around it. That placement
mirrors the family app and is the whole point: `/signin` renders outside the layout, and the
terms link has to be reachable from the signup form.

Terms, Privacy, Contact. **No separate `/cookies` page**: the privacy page carries a short
local-storage section instead, and `src/lib/browserStorage.test.ts` already sweeps `src/kitchen`
through `sourceFiles.ts`'s `../**/*.{ts,tsx}` glob, so the claim is held mechanically rather
than promised.

Both pages render `<div className="prose plate">`. **Both classes matter**: `.plate` carries the
rule that recolours headings, and a `.prose` without it once shipped bone headings on a bone
plate.

## The documents

Full wording lives in the pages. These are the clauses that carry weight, recorded here so a
later session can tell a decision from a phrasing it may improve.

### Kitchen terms

- **A sign-off is a record, not a certification.** The app does not check allergens, verify
  yield or compute costs, and nothing in it discharges HACCP, allergen law or any local
  food-safety duty. This is the clause this product specifically needs, the counterpart of the
  family app's "Cooking from what you find here", and it must not be softened to save words.
- **Do not make this your only copy of a record you are legally required to keep.** The honest
  sentence for a food business using a free tool in development.
- **Whose content it is.** Dishes, versions, sign-offs, deviations and staff names belong to the
  business, not to the person typing them and not to the operator. Permission to store and
  display is given so the app can run, and covers nothing else: no selling, no publishing a
  private dish, no training a model.
- **Publishing is the step you cannot take back.** An owner publishing a dish puts it on the
  family app's public side under the venue's name, where family cooks may save copies into their
  own vaults; a takedown removes the public page and not the copies. That is what `0044` and
  `0045` actually do, so the terms have to say it before an owner presses the button.
- **The records are named.** The app stores who signed a version off and who recorded a
  deviation. A business adopting it is telling its staff that, and the terms say so rather than
  leaving the staff to discover it.
- **Minimum age 18**, not the family app's 13. This is a workplace tool.
- Free, nothing to buy, no contract, nothing to refund because no money changes hands; as-is,
  with the same warranty disclaimer, the same hundred-dollar cap, and the same two things not
  limited: death or personal injury by negligence, and fraud. Ohio law, Franklin County, the
  same as the family side, because it is the same operator in the same place.

### Kitchen privacy

- **Two controllers**, as set out under The parties above. This is the structural difference from
  the family page.
- **What is collected**: email and password, display name, which org and site you belong to and
  in which role, dishes with their versions, ingredients and steps, approvals with who and when,
  deviations with who and when, invite codes, and the version of the terms you accepted.
- **Processors: Supabase, Cloudflare, and Google for sign-in only.**
- **There is no AI import on this host, and nothing goes to Gemini, DeepSeek or Groq.** Verified
  2026-10-11: `src/kitchen` and `src/lib/api/kitchen` contain no `fetch`, no
  `functions.invoke`, no `extract-recipe` and no `errorLog`, so the kitchen app's only outbound
  destination is Supabase. **It also sends no error reports**, because `src/kitchen/main.tsx`
  installs none of the listeners `src/main.tsx` does. Both sentences are facts about today's
  code that a test has to defend, which is why `processors.test.ts` is extended below.
- A short cookies and local-storage section, in place of a third page.
- Retention, rights, international transfers, security stated honestly, children (not for
  children, and the terms require 18), changes, contact.

## Four mechanical defences

This project's own evidence is that **the failure mode is not ignorance, it is not re-reading**:
three bugs on 2026-09-27 had their lesson already written down before they happened. So each
decision above that a later session could quietly undo gets a guard, and **each is watched fail
before it goes green**.

| Guard | What it stops |
| --- | --- |
| `kitchen_seal.test.ts` follows transitive imports | A component shared from `src/kitchen` dragging a family data module in behind it |
| `src/kitchen/routes.terms.test.tsx` | A kitchen action route landing outside the gate |
| a kitchen version fingerprint test | Kitchen terms wording moving without `KITCHEN_TERMS_VERSION`, so nobody is re-asked |
| `supabase/processors.test.ts` extended | The kitchen privacy page claiming no AI provider after kitchen code gains an outbound endpoint |

### The seal had a hole

`kitchen_seal.test.ts` reads the direct import specifiers in files under `src/kitchen`. So
`import TermsGate from "../components/TermsGate"` passes it, while `TermsGate` imports
`lib/api/profile.ts` transitively. **Reusing the family gate would therefore have broken the
seal with the seal's own test green**, and reusing it is the obvious first instinct, which is
how the hole would have been found: too late.

The fix follows relative imports out of `src/kitchen` through the shared modules they reach and
fails if any module reachable from the kitchen app imports a disallowed `lib/api/` module. An
unguarded assumption inside a safety check is a dated one, which the seal's own comments say
about `rls.test.ts`'s schema skip; this is the same mistake one level up.

### The routes test

Mirrors `src/routes.terms.test.ts` in spirit, source-reading rather than behavioural, because
the defect would be in the wiring and rendering the whole router to prove it would mock away the
composition under test. It asserts the three bands, with the ungated paths as an explicit list
that has to be edited deliberately rather than drifting.

### Extending `processors.test.ts`

Today it reads `src/pages/Privacy.tsx` only. It gains a kitchen half that holds the kitchen page
to **its own app's** processors. Requiring the kitchen page to name Gemini would make it a lie,
so the check is not "name every provider in the repo" but "if kitchen code can reach an
endpoint, the kitchen page names it". The sentence being defended is the kitchen page's claim
that nothing there goes to an AI provider.

## Verification

- `npx tsc -b && npm test`, and `npx supabase db reset` for `0046`.
- An integration test that one user cannot read another's acceptance row, under `supabase/`.
- **A browser walk on the local stack with a fresh account**, because eleven defects on this
  project have now shipped past a green suite and been found by walking the app. Sign up on the
  kitchen host; confirm the gate blocks the dashboard; read both documents from the footer while
  signed out; accept; confirm no re-ask; bump the version and confirm the re-ask.

## The family terms, which turned out not to need writing

`PRODUCT.md` recorded `/terms` as "a deliberately short first draft" with **seven** things
missing, and then enumerated six: a food safety and liability disclaimer, a privacy notice, who
operates it and under which jurisdiction, a minimum age, a line saying the terms can change, and
a photo licence. The seventh was the contact address, which the same entry hands off to
`HANDOVER.md`, so the count was already one ahead of the list.

**All six are closed in the current page**, by "Cooking from what you find here" with "What is
not promised", by `/privacy`, by "Who you are agreeing with" with "Which law applies", by the
age of 13 in "Who may use it", by "If these terms change", and by "Permission to show them".
That entry was stale, and the handover carried it forward into this session's plan as work to
do.

So the family half of this session is the correction, not a rewrite. **Not touching `Terms.tsx`
is the better outcome**: changing its wording would bump `TERMS_VERSION` and re-ask every
existing family cook to accept, for no new clause.

What is genuinely still open on the family side is recorded in `PRODUCT.md` and unchanged by
this spec: a DPA and a retention schedule as signed documents rather than intentions, and
reconsidering the AI import's data path.
