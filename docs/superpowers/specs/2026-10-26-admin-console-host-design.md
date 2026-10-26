# The console moves to its own host

**Decided 2026-10-26.** The second half of the `PRODUCT.md` entry whose first half shipped as the
audit log (`0066`). The console leaves the family app for `admin.enamelvault.com`, and the three
apps share one session through a cookie on `.enamelvault.com`.

## Why

Moderation should not require opening a product to do a job that is about neither product. That
is the whole reason, and it is Aayush's. Everything below is the cost of honouring it without
breaking something else.

## Decisions taken, so the builder does not reopen them

- **Its own subdomain**, a third app beside `index.html` and `kitchen.html`.
- **A shared auth cookie on `.enamelvault.com`**, so one sign-in covers all three origins.
- **Everything moves**: reports, appeals, recipes, people, kitchen counts, trail. The family app
  loses `/moderation` entirely, so there is one console and no question about where to look.

## The security trade this makes, stated once and on purpose

**The session cookie cannot be `HttpOnly`,** because supabase-js reads the session from
JavaScript. Today each origin keeps its session in its own `localStorage`, so an XSS on the
kitchen host cannot reach the family session. A shared cookie removes that isolation: one XSS on
any `*.enamelvault.com` host yields a session valid on all of them, including this console, whose
whole job is privileged.

**What makes this acceptable rather than reckless is the CSP**, `script-src 'self'`, which the
Worker already sends and `worker/meta.test.ts` already pins. That header stops being a
defence-in-depth nicety and becomes the control this design leans on. **The new host must send
the same CSP, and its test must pin it**, before the cookie is switched on. A console host
served without that CSP is the one combination this design must never ship.

Cookie attributes, all of them load-bearing: `Domain=.enamelvault.com`, `Secure`, `SameSite=Lax`,
`Path=/`, and NOT `HttpOnly` for the reason above. `SameSite=Strict` is wrong here because the
OAuth callback returns cross-site and would arrive without the cookie.

## Goals

- One sign-in across the three hosts.
- `admin.enamelvault.com` serves the console and nothing else, is not indexed, and refuses every
  route to a non-moderator.
- The family app no longer has `/moderation` at all.
- Every public claim about cookies becomes true in the same commit that makes it false.

## Non-goals

- Changing what the console does. This is a move plus a session change; filters, per-cook views
  and search are explicitly not in it.
- Moving the kitchen app's own session model. It keeps its own terms gate and its own
  acceptance table; it simply stops needing a second sign-in.
- The `kitchen` schema. The console keeps reading kitchen numbers **counts-only through the
  `admin` function**, which stays the single sanctioned crossing. `kitchen_seal.test.ts` holds
  that line and a console with its own host will be tempted to cross it.

## Anti-goals

- **A third app that ships ungated.** This has already happened once: a guard covering one of two
  apps reported success for the app it could not see, and the kitchen app shipped its entire
  surface ungated with the suite green. `src/routes.terms.test.ts` and
  `src/kitchen/routes.terms.test.tsx` are the precedent. A third router without its own guard
  test repeats that bug a third time, and this time on the moderation surface.
- **The app telling two stories about itself.** `/cookies`, both privacy pages and both marketing
  footers currently state that the app sets no cookie. The moment one does, those are false.
  They move in the SAME commit, or not at all.
- **A second source of truth for authority.** `is_moderator` and `is_owner` stay on
  `public.profiles`. The console host reads them exactly as the family app does today.

## The parts

### 1. A third app

`admin.html` at the repo root (it must be BUILT, same reason `kitchen.html` is not in `public/`),
`src/admin/` for its code, a third `rollupOptions.input` entry, and `admin.localhost` added to
`kitchenDevHost()` and `server.allowedHosts` so it can be walked in dev. The dev-host plugin
generalises from one hostname to a table; that is the lazy change, not a second copy of it.

### 2. Worker routing

`isAdminHost()` in `worker/site.ts`, written as an EXACT match like `isSiteHost`, never
`endsWith`: `enamelvault.com.evil.example` passes a suffix test and anything trusting the result
is then trusting an attacker. `admin.html` is fetched internally and refused as a path, exactly
as `site.html` and `kitchen.html` are. The host sends the same CSP as the others plus
`X-Robots-Tag: noindex`, serves its own `robots.txt` disallowing everything, and appears in NO
sitemap.

### 3. The shared session

A cookie-backed storage adapter passed to `createClient` as `auth.storage`, replacing the default
`localStorage`, used by all three apps so they agree on where the session lives.

**It must chunk.** A Supabase session JSON holding an access token, a refresh token and the user
object routinely exceeds the ~4096-byte limit a single cookie allows, and a silently truncated
cookie is a session that fails to restore in a way that looks like a random sign-out. Chunk at
about 3180 bytes with a numbered suffix, and delete every chunk on sign-out, including ones a
larger previous session left behind.

**Supabase's redirect allow list needs the new host**, with the GLOBSTAR form
`https://admin.enamelvault.com/auth/callback**`. `docs/OPERATIONS.md` documents the trap: without
the globstar the hosted service silently substitutes the Site URL and the whole mechanism is
inert. `src/lib/nextPath.ts` is the single place `?next=` is built and validated, and `safeNext`
is a trust boundary rather than a tidy-up: it gains the admin origin and nothing else.

### 4. The documents, in the same commit

- `src/pages/Cookies.tsx`: the app now sets one cookie, what it is for, that it is strictly
  necessary, and that it carries no analytics. Bump `COOKIES_UPDATED`.
- `src/pages/Privacy.tsx` and `src/kitchen/pages/Privacy.tsx`: same correction. Bump
  `PRIVACY_UPDATED` and `KITCHEN_PRIVACY_UPDATED`.
- Both marketing footers, via whatever `src/site.claims.test.ts` asserts.
- `src/lib/browserStorage.test.ts`: it fails the build the moment a cookie appears, which is
  correct and is the alarm here. It is amended to permit exactly this one cookie by name and to
  keep failing for any other, and for any analytics or tracking cookie. **Do not soften it to a
  blanket allowance**; that would remove the only mechanism forcing `/cookies` back into
  agreement with the code.
- `src/pages/legalDates.version.test.ts` fingerprints each page and will demand the new hashes.

Whether the terms gate re-prompts is a judgement the mechanism will not make: a cookie is a
material change to how the product stores your data, so **bump `TERMS_VERSION` and
`KITCHEN_TERMS_VERSION` and re-prompt both apps.** Recorded here as the decision rather than left
to the builder.

### 5. The guard, which is the part most likely to be skipped

`src/admin/routes.terms.test.tsx`, reading the admin router the way the other two guards read
theirs. **The admin app has no terms gate and does not need one**: it is not a consumer product
and its only user is an operator. Its guard asserts the analogous thing, that **every route in it
sits behind the moderator gate**, with no route reachable by a signed-in non-moderator. That is
this builder's call, made because the existing guards test "no action route escapes the gate this
app has", and the gate this app has is the moderator check.

The route itself must check, never the nav: a hidden link is not a permission, anyone can type
the URL, and the nav is one refactor away from showing it to everybody.

### 6. The family app gives it up

`/moderation` is removed from `src/routes.tsx`, with `Moderation.tsx` and its test moving under
`src/admin/`. The family app's nav loses the link. `src/routes.terms.test.ts` must still pass,
and will now be guarding one fewer route.

## Hopping between the three apps

Decided 2026-10-26, after the three above. The shared cookie makes the SESSION seamless; this is
about the links.

- **The family app links to the kitchen app for everyone.** It is a product of the same operator,
  already marketed on `enamelvault.com`, so it leaks nothing.
- **All three apps link to the console when you are a moderator**, which needs the kitchen app to
  know that, and `is_moderator` lives on `public.profiles` where `kitchen_seal.test.ts` forbids
  the kitchen app from reaching it.

**The claim comes from a CUSTOM ACCESS TOKEN HOOK, not a trigger and not a stored column.** A
Postgres function Supabase calls when it mints a token, which reads `public.profiles.is_moderator`
at mint time and adds the claim. This matters: a trigger copying the flag onto `auth.users` would
be a genuine second source of truth for authority, which `PRODUCT.md` warns against and which the
first version of this decision implied. A mint-time hook is a CACHE WITH A TTL instead, and
`profiles` stays the only place the answer lives.

**The claim is NAVIGATION ONLY, and this is the rule that keeps the decision safe:**

- `is_moderator()` in Postgres keeps reading `profiles`. Policies do not change.
- The `admin` edge function keeps reading the flag with the CALLER's client, so RLS authorises it.
  It must never read the claim; its header already says the caller is identified from the
  verified JWT and never from anything the caller supplies, and a claim is closer to the latter.
- The admin app's route guard may read the claim to decide what to DRAW, and the server refuses
  regardless.

**It goes stale, on purpose, and that is survivable only because of the rule above.** A token is
minted at sign-in and refreshed about hourly, so a demoted moderator keeps a claim saying
otherwise until their next refresh. The worst case is that they see a link and the console
answers "Not found". If the claim were ever used for enforcement, the same staleness would be an
hour of real authority after removal, which is why the rule is absolute rather than stylistic.

The hook is configured in `supabase/config.toml` for local and in the dashboard for cloud, and it
is one more thing that does not deploy automatically. `docs/OPERATIONS.md` gains it.

## Left to the builder

- Whether `src/admin/` reuses the family app's shell components or gets a plain one. The console
  is five tables and a toggle; it does not need the family app's chrome.
- The cookie's name, beyond that it must be stable and greppable.
- Whether the three apps share one `supabaseClient.ts` or each construct a client from a shared
  factory. They share one today and nothing here requires changing that.
- Only use CSS class names `src/index.css` actually defines. A missing class fails nothing and
  renders unstyled, which the kitchen shell shipped once with an invented `appbar`.

## The order this ships in

The cookie switch and the document corrections are ONE commit, because between them the app is
lying about itself. The new host can land before that, serving the console while sign-in is still
per-origin, which keeps the risky change small and separately revertable.

1. The third app, its Worker route, its CSP and noindex, its guard test. Sign-in still per-origin.
2. The console moves; the family app drops `/moderation`.
3. The cookie adapter, the allow-list entries, every document, and the terms re-prompt, together.
