# The page before sign-up

Decided 2026-10-09. The first public surface in the Persuade register, and the first thing
this project serves from the bare domain.

## The problem

A stranger who opens `recipes.enamelvault.com` today is bounced by `RequireAuth` to
`/signin`, a bare sign-in form. The only thing on that page that says what the product is
is a "Need an account?" link. Nothing asks for their interest before asking for their
commitment.

(The earlier record of this said they land on the sign-up form. They do not: they land on
sign-in, which is slightly worse, because sign-in is written for someone who already knows
what this is.)

## Decisions

### It lives on the bare domain

`enamelvault.com` becomes the marketing surface. `recipes.enamelvault.com` stays the app,
unchanged, including `/` still bouncing a signed-out visitor to `/signin`.

This is the arrangement the redirect decision of 2026-09-25 was taken to preserve: that
redirect was deliberately made a 302 rather than a 301 specifically so that putting a page
on the bare domain later would not be fought by the permanent cache of everyone who had
already visited. This spec is that later.

### It is served by the existing Worker, not a second project

`enamelvault.com` is added as a second custom domain on the `familyrecipes` Worker, and the
edge redirect rule is deleted. `route()` in `worker/index.ts` branches on hostname before
anything else; the bare host is served by a new `serveSite()`, and every existing path on
the app host keeps its current behaviour.

Rejected: a separate Cloudflare Pages project. It is the right answer the day this is five
pages and a blog, and it is the wrong answer now. It buys a second deploy path that nobody
will remember, which this project already has four of in its edge functions, and a second
copy of the colour tokens, the fonts and the type scale, which will drift from `DESIGN.md`
silently. Moving to it later is cheap, because what this spec builds is one standalone HTML
file.

### It is static HTML, not React

The page ships no JavaScript. It is one HTML response.

This was questioned on the grounds that a React tree would reuse the app's components, and
the answer is that it would not reuse much: every component in `src/` is bound to
`react-router`, `AuthContext` or the Supabase client, none of which this page has. What it
would share is the colour tokens and the type, which are CSS.

The decisive reason is the one the host was chosen for. Strangers and crawlers arrive here,
and a client-rendered React page serves a crawler an empty shell. The one job this surface
exists to do is the job React does worst without a prerender step, and a prerender step for
a page with no interactivity is work bought for nothing.

**The cost of this decision is that the page's CSS duplicates the `DESIGN.md` tokens, and a
duplicate drifts.** That is answered with a guard rather than a paragraph: a test reads the
real hex values out of `src/index.css` and fails if `public/site.html` disagrees. See
Testing. This project's own evidence is that a written rule does not hold and a failing test
does.

### The audience is the future paying customer

Not only the invited relative. The page is built as the top of a funnel that will eventually
include the professional-kitchen version, which means its structure has room for a second
audience rather than being a single warm note to a cousin.

**What that does NOT license.** `PRODUCT.md` records that no testimonials, reviews, customer
names, usage benchmarks or pricing exist anywhere in this product and that none may be
invented, and it records that the business version is undesigned and must not be started
from a list. So the page may be built to grow a funnel and may not pitch anything that does
not exist. Every capability it names is one that is already built and deployed.

### It asks for two things, side by side

- **For a family:** the single vermilion action, to `recipes.enamelvault.com/signup`.
- **For a professional kitchen:** a plate that says in plain words that it is in development,
  and a `mailto:` to start a conversation.

The risk accepted here, stated so it is not rediscovered as a surprise: two actions give a
stranger two decisions on arrival, and the second advertises a direction rather than a
product. The mitigation is wording, not layout. The kitchen plate must never read as a tier
you could buy. It says it is being worked on and invites a conversation, and that is all it
says.

No waitlist form and no email capture. A captured address is personal data: a table with
RLS, a change to `Privacy.tsx`, a retention answer and a spam problem, all of which is more
work than the page. A `mailto:` collects the same demand in the same inbox with no data path
at all.

### It shows three real public recipes

Not words alone, not an illustration, not a screenshot. Three real published recipes, each
card linking to its public page on the app host.

This exposes nothing new. Those pages are already readable with no session, already carry
per-recipe OpenGraph tags, and are already in the sitemap, which is why guarding them was
rejected in `routes.tsx`. What is new is that they are now on a shopfront, which is a
judgement already taken: these are the author's own recipes, published by hand.

## The page

In order:

1. **Masthead.** The mark from `public/favicon.svg`, the wordmark, and one quiet Sign in link
   to the app host.
2. **The claim.** One `h1` and one paragraph saying what it is: a private vault where a family
   keeps its recipes with the story and who they came from.
3. **The two actions**, side by side, as above.
4. **Four capabilities**, each already built and deployed: the private vault with per-recipe
   visibility, provenance and story, entry from a photo of a handwritten card or from your
   voice, and the grocery list with Cook Mode.
5. **The rack.** Three real public recipes.
6. **Footer.** Terms, privacy, cookies and help, all linking to the app host where they are
   already public routes, plus the named controller, which is what UK and EU law requires and
   what `Privacy.tsx` already says.

### Visual

One theme only, the green world, with no light/dark toggle: `theme-init.js` is the app's
bootstrap and this page has no JavaScript. The wall is `--wall` (`#1f3b34`), content rides
on bone plates (`--plate`, `#f3ede1`) with the `--rim` keyline, titles and controls are Zilla
Slab in caps, and exactly one vermilion (`--action`, `#b53514`) fills the family action.

Links on the green wall use `--action-lit` (`#ff8f73`) and links inside a plate use
`--action` (`#b53514`). That pair is not a stylistic choice: `index.contrast.test.ts` records
that no single vermilion passes AA on both grounds.

Fonts resolve from `/fonts/*.woff2`, which are assets on this same Worker and therefore
present on the bare host too. This is one of the reasons the second-project approach was
rejected: under `font-src 'self'` a separate host would need its own copy.

## The data path

`serveSite()` fetches the template, `public/site.html`, through `env.ASSETS`, asks Supabase for the newest three
public recipes with the anon key already in `wrangler.jsonc`, and injects cards into
placeholder tokens in the template. This is the same shape as `enrichRecipePage`, which
already injects per-recipe OpenGraph tags into `index.html`.

Three rules on that query.

**It calls the `search_recipes` RPC with a null family id. It does NOT query `recipes`.**
This is the whole of it, and it is not an optimisation. The rule that takes a cleared cook's
recipes out of the public catalogue lives inside that function and nowhere else, and `0035`
says so in a comment at the function, with the reason: a second path that queried `recipes`
directly silently bypassed every rule the function held, and a muted cook stayed in the feed
until you typed something. A landing page that queried the table would be a public bypass of
a live moderation decision, which is strictly worse than the bug that comment describes.
`src/lib/api/recipes.ts` refuses to grow a second path for the same reason.

**It degrades to the template untouched.** If the query fails or returns nothing, the rack
section is removed and the page still serves. Zero public recipes is a reachable state, not
a theoretical one: there are six today and unpublishing is one click each. This follows the
Worker rule in `CLAUDE.md`, that `worker/index.ts` must always degrade to serving the
untouched asset.

**Five minutes of `Cache-Control`,** so a crawl does not query Supabase once per hit.

### `/site.html` is not a URL

The template is an asset, so without a guard it is also reachable as `/site.html` on both
hosts: on the app host it is a stray page nobody meant to publish, and on the bare host it is
the page with its placeholders still showing. `route()` answers 404 for that path on any
host, and `serveSite()` reaches the file through an internal `env.ASSETS.fetch` of its own
rather than by passing the visitor's request along. One `if`, and `worker/site.test.ts` pins
it, because a page that leaks its own uninjected template is exactly the kind of thing that
answers 200 and looks fine.

### What was verified before this was written, and what still must be

Traced, in the migrations: `search_recipes` is `security invoker` with no `revoke`, so anon
may execute it and RLS confines it to public rows. Its block filter calls
`hidden_from_feed(auth.uid(), ...)`, and for an anonymous caller `auth.uid()` is null; the
function body is an `exists`, which returns false rather than null for a null argument, so
`not hidden_from_feed(...)` is true and anon gets rows rather than silently getting none.

That is a reading of the code, not evidence. **The first task of the plan is a live,
read-only anon call against the cloud project proving the RPC returns public recipes to an
unauthenticated caller**, before anything is built on the assumption. A plan whose premise
was checked only by reading is how this project got the auth ordering wrong once already.

## SEO, which is the point of the host

- The bare host answers its own `/robots.txt` and `/sitemap.xml` from the Worker. The app
  host keeps the asset it has.
- The landing page carries a canonical of `https://enamelvault.com/`, OpenGraph tags, and
  `WebSite` JSON-LD. Its `og:image` is the existing `OG_CARD`, absolute, as
  `worker/meta.ts` already requires.
- `STATIC_SITEMAP_PATHS` in `worker/index.ts` currently advertises `/` on the app host,
  which is a redirect to a sign-in form. It comes out. The bare domain owns the root now.

## Security and privacy

The existing `securityHeaders()` applies unchanged, and the page is written to fit it rather
than the other way round:

- `script-src 'self'` and the page has no script at all, inline or otherwise. A blocked
  inline script fails silently, which is why `theme-init.js` exists as a file.
- `style-src 'self' 'unsafe-inline'` already permits the one `<style>` block the page needs.
- `img-src` already permits the Supabase origin that serves recipe photos.

**The page sets no cookie, no `localStorage` key, no `sessionStorage` key and no analytics.**
That is what keeps `browserStorage.test.ts` green and what keeps the claim on `/cookies`
true. The moment this page gains any of them, a consent banner stops being optional.

No new third party is contacted, so `Privacy.tsx` needs no new name. The plan confirms that
rather than assuming it, because `CLAUDE.md` makes any new outbound call part of that page's
change.

## Testing

| Test | What it stops |
| --- | --- |
| `worker/site.test.ts` | The pure helpers breaking: card HTML, escaping, the injection, and the two degraded cases (query failed, query empty) removing the rack rather than leaving a hole |
| the same file | The bare host's `robots.txt` and `sitemap.xml` bodies changing by accident |
| `worker/site.tokens.test.ts` | `public/site.html` drifting from the real tokens in `src/index.css`. This is the mechanical half of the not-React decision and it is not optional |
| `index.contrast.test.ts` | A colour pair on the new page dropping below AA. The landing page's pairs are added to the existing test, which reads the real tokens |
| `worker/site.a11y.test.ts` | A missing `alt`, a second `h1`, a bare "click here" link, or a missing landmark. The existing `accessibility.test.ts` works on React trees and cannot see this file |
| `worker/meta.test.ts` | The CSP changing. Already pinned; the new code must not need an exception |

And one thing no test can do. **This page is walked in a browser, signed out, in a private
window, at mobile width, before it is called done.** Six defects on this project have shipped
past a green suite, a clean typecheck and a review, and were found in seconds by opening the
app; the vault note `Green tests are not a browser pass` is the write-up. A marketing page is
the worst possible candidate for trusting a suite, because a suite cannot see colour, type or
layout, which is most of what this page is.

## Out of scope, deliberately

- **The professional-kitchen product.** This page gains a `mailto:` and an honest sentence
  about it. The product itself is a separate brainstorm, which happens after this ships.
- A waitlist, email capture or analytics, as above.
- `www.enamelvault.com`, beyond confirming during deployment that it resolves to the same
  place as the apex rather than to nothing.
- Any restyle of Potluck or the cook page. Those are parked by the decision of 2026-09-28,
  and that parking covers surfaces that already work. This one does not exist yet, which is
  why it is not parked.
