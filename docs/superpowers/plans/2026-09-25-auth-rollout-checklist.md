# Auth rollout checklist (verified email, then Google)

Companion to `../specs/2026-09-25-google-signin-and-verified-email-design.md`. That spec says
WHY and WHAT. This says exactly what to click, in what order, and how to know each step worked.

Everything in stages 0 to 5 is Aayush's, outside this repo. The code is mine and starts at
stage 6. **The order is a constraint, not a preference.** See the spec.

## Constants you will paste repeatedly

| Thing | Value |
|---|---|
| Supabase project ref | `ghcclshgdtbystosfzjl` |
| Supabase dashboard | `https://supabase.com/dashboard/project/ghcclshgdtbystosfzjl` |
| App origin | `https://recipes.enamelvault.com` |
| Cloudflare zone | `enamelvault.com` (id `534b45be9cc7ffdd92e4792900bbec9c`) |
| Google's redirect URI | `https://ghcclshgdtbystosfzjl.supabase.co/auth/v1/callback` |

## State verified on 2026-09-25, before any of this

Read live from `https://ghcclshgdtbystosfzjl.supabase.co/auth/v1/settings`, and from DNS:

- `"google": false` and every other provider false. `"email": true`. So nothing is half-done.
- **`"mailer_autoconfirm": true`** — see stage 0, this is the interesting one.
- `"disable_signup": false`, `"phone": false`.
- The `enamelvault.com` zone has **no TXT record of any kind**, so Resend is not started.

---

## Stage 0: RESOLVED 2026-09-25. The premise was wrong; the ordering is dissolved.

`select email, email_confirmed_at, created_at from auth.users` on cloud returned **4 users, all
with `email_confirmed_at` set, each within ~50ms of its own `created_at`**. That is
`mailer_autoconfirm` stamping them at signup, not anyone confirming anything.

```
x1789698549531@t.dev     confirmed 2026-09-18   (test junk)
e2e-live@test.dev        confirmed 2026-09-18   (test junk)
aayus.pok@gmail.com      confirmed 2026-09-19
megan.r.dodds@gmail.com  confirmed 2026-09-20
```

**Consequences, in order of how much they change:**

1. **Google is no longer blocked by email verification.** The spec's whole rollout order exists
   to stop Supabase refusing to link an OAuth identity to an unconfirmed account. These accounts
   are confirmed, so linking should work today. Stage 5 can be done first, or alone.
2. **The "all our recipes are gone" failure the spec was written to prevent cannot happen the
   way it describes it.** Signing in with Google as `aayus.pok@gmail.com` should land in the
   existing account, family and recipes intact.
3. **The takeover risk the confirmation flag normally guards is real but currently empty.** Both
   real accounts are Gmail addresses whose owners plausibly typed them in themselves. The risk
   is about FUTURE signups, not the present four.
4. **Stage 4, the gate, is now trivial.** Existing users stay confirmed even after confirmation
   is switched on; `email_confirmed_at` is already set and nothing clears it. There is nobody to
   confirm retroactively.

**What is still worth doing, and why, now that it is not a blocker:** real verification means a
password reset reaches a real person, and that "who is in this family" is a claim someone
proved. That is worth an evening on its own merits. It is no longer a prerequisite for anything.

- [ ] Delete `x1789698549531@t.dev` and `e2e-live@test.dev`. Test junk in the production auth
      table, and two fewer rows to reason about next time.

**This is now a two-track plan, not one ordered chain.** Track A (stages 1 to 4) and track B
(stage 5 plus my code) are independent. Pick either, or both.

## Stage 0 (original): check the spec's premise before trusting the rest of it

The spec says "confirmation is off, so **every existing account has an unconfirmed email**", and
builds the forced ordering on top of that. **That premise may be wrong**, and it is worth two
minutes before you spend an evening on it.

`mailer_autoconfirm: true` in GoTrue does not mean "nobody is confirmed". It means "skip the
email and mark them confirmed immediately". If that is what happened, your existing accounts
already have `email_confirmed_at` set, despite nobody ever having proved they own the address.

**Check it:** dashboard -> Authentication -> Users. Look at whether existing users show as
confirmed.

- [ ] Checked. Existing users are: `confirmed` / `unconfirmed` (circle one)

**Either way, keep the ordering.** If they are already confirmed, the reason changes but does
not weaken:

- If **unconfirmed**: the spec is right as written. Google would refuse to link and would
  silently create a second, empty account. Stage 4 is mandatory.
- If **already confirmed**: Google linking would work immediately, which is the *worse* case.
  Every one of those addresses is unproven, so enabling Google would mean that whoever really
  owns an address typed into this app can sign in with Google and land inside that account,
  with its family and its recipes. Turning on real verification first is still the fix; stage 4
  becomes "spot-check", not "confirm everyone".

Tell me which it is. It changes what I write in stage 4 and nothing else.

---

## Stage 1: a sending domain on Resend

Using a subdomain rather than the apex, so app mail cannot damage the reputation of
`enamelvault.com` itself, and so a future mailbox on the apex does not collide with this.

### 1A. Resend account and domain

- [ ] Sign up at `https://resend.com`. Free tier is 3,000/month and 100/day, far beyond this
      app's needs. No card required.
- [ ] Verify your own Resend login email (ordinary signup, unrelated to everything below)
- [ ] **Domains** -> **Add Domain**
- [ ] Name: **`mail.enamelvault.com`** — type the subdomain, NOT `enamelvault.com`
- [ ] Region: whichever is nearest you. It only sets where sending is served, but it DOES
      change the values in the records below, so do not mix regions between attempts.
- [ ] Click Add. Resend now shows a **table of DNS records**. Leave that tab open.

### 1B. The name translation that catches everyone

Resend prints record names **relative to the domain you added** (`mail.enamelvault.com`), but
Cloudflare's zone is **`enamelvault.com`** and appends the zone to whatever you type.

**So every name Resend shows you gains `.mail` when you type it into Cloudflare:**

| Resend shows | You type in Cloudflare | Which really means |
|---|---|---|
| `send` | `send.mail` | `send.mail.enamelvault.com` |
| `resend._domainkey` | `resend._domainkey.mail` | `resend._domainkey.mail.enamelvault.com` |

If Resend shows a name already ending in `.mail.enamelvault.com`, strip the `.enamelvault.com`
and type what is left. **Never paste a name ending in `.enamelvault.com` into Cloudflare**, or
you get `...enamelvault.com.enamelvault.com`. That is the most common failure here, and it
presents as a Resend check that simply never goes green, with no error explaining why.

### 1C. Add the records in Cloudflare

`https://dash.cloudflare.com` -> `enamelvault.com` -> **DNS** -> **Records** -> **Add record**,
once per row. Typically three rows:

- [ ] **MX**, name `send.mail`, content the `feedback-smtp.<region>.amazonses.com` value Resend
      gives, **Priority 10**. This is bounce handling.
- [ ] **TXT**, name `send.mail`, content `v=spf1 include:amazonses.com ~all` (SPF)
- [ ] **TXT**, name `resend._domainkey.mail`, content the long `p=MIGfMA0...` DKIM key

- [ ] **DMARC, which Resend does not give you.** TXT, name `_dmarc`, content
      `v=DMARC1; p=none; rua=mailto:aayus.pok@gmail.com`
      Put it at `_dmarc` (the org domain), **not** `_dmarc.mail`, so it covers the whole zone:
      a subdomain with no DMARC of its own inherits the org domain's. `p=none` is monitor-only
      and is the correct place to start. Tighten later only if you care.

**Gotchas that will waste your time:**

- **Paste the DKIM key whole, as one line.** It is long and wraps in the browser; a line break
  or a dropped character fails silently and looks identical to a typo you cannot see.
- **Do not include the outer quotes** on TXT values. Cloudflare adds them.
- **Only one SPF TXT per name, ever.** Two SPF records on `send.mail` is worse than none: it is
  a permanent error, not a merge. If you retry the setup, EDIT the existing one.
- **Everything here stays DNS-only (grey cloud).** MX and TXT have no proxy toggle at all, so
  this only bites if Resend hands you a CNAME.
- Leave TTL on Auto.

### 1D. Verify

- [ ] Back in Resend, click **Verify DNS Records**. Usually green within a minute or two on
      Cloudflare. If not, re-click; do not re-add the records.
- [ ] Send yourself a test from Resend's dashboard, confirm it arrives, **and check spam**

### 1E. The API key for stage 2

- [ ] Resend -> **API Keys** -> **Create API Key**
- [ ] **Sending access** is enough. Do not grant full access.
- [ ] **Copy it now.** Resend shows the value once and never again.
- [ ] It becomes the SMTP password in stage 2. It is a credential: do not paste it into chat,
      a commit, or this file.

## Stage 2: point Supabase at it

Dashboard -> Project Settings -> Authentication -> SMTP Settings.

- [ ] Enable Custom SMTP
- [ ] Host `smtp.resend.com`, Port `465`
- [ ] Username `resend` (literally that word, it is not your email)
- [ ] Password: the Resend API key from stage 1
- [ ] Sender email: `recipes@mail.enamelvault.com` (must be on the verified domain, or
      everything bounces)
- [ ] Sender name: `The Enamel Vault`

- [ ] **Raise the email rate limit.** Authentication -> Rate Limits -> emails per hour.
      **Enabling custom SMTP silently drops this to 30/hour.** It will not bite you in testing
      and will bite you the evening you tell the whole family at once. Set it to 100+.

Authentication -> URL Configuration:

- [ ] Site URL: `https://recipes.enamelvault.com`
      (**if this is wrong, every confirmation link points at localhost** and the whole thing
      looks broken to everyone but you)
- [ ] Redirect URLs, add both:
  - [ ] `https://recipes.enamelvault.com/**`
  - [ ] `http://localhost:5173/**` (so local dev keeps working)

## Stage 3: turn confirmation on

- [ ] Authentication -> Sign In / Providers -> Email -> **Confirm email: ON**
      (this is the `mailer_autoconfirm` flag from stage 0, inverted)

**Verify, and do this on a throwaway address, not yours:**

- [ ] Sign up on the live site with an address you control but have never used here
- [ ] The app shows its "check your email" panel instead of logging you straight in
      (already built in `SignUp.tsx`, never yet exercised in production)
- [ ] The email actually arrives, from `recipes@mail.enamelvault.com`, not in spam
- [ ] The link lands on `recipes.enamelvault.com` and signs you in
- [ ] Delete that throwaway user afterwards

## Stage 4: the gate — now a formality, see stage 0

Stage 0 found every existing account already carries `email_confirmed_at`, and switching
confirmation on does not clear it. So there is nobody to confirm retroactively and nothing here
blocks Google.

- [ ] Re-run the stage 0 query and confirm it still returns no nulls
- [ ] Delete the two test accounts if you have not already

## Stage 5: Google

Google Cloud Console, a new project is fine.

- [ ] APIs & Services -> OAuth consent screen -> **External**
- [ ] App name `Family Recipes`, support email, developer email. No logo needed.
- [ ] Scopes: the defaults (`email`, `profile`, `openid`). **Add nothing else** — anything more
      triggers Google's verification review, which is weeks.
- [ ] **Publishing status: decide deliberately.** In *Testing*, only addresses you list as test
      users can sign in (max 100), and refresh tokens expire after 7 days, so the family would
      be quietly logged out weekly. **Publish the app.** With only basic scopes it publishes
      without review.
- [ ] Credentials -> Create OAuth client ID -> **Web application**
- [ ] Authorised redirect URI: `https://ghcclshgdtbystosfzjl.supabase.co/auth/v1/callback`
      — **the Supabase URL, not the app domain.** This is the single most common mistake here.
- [ ] Authorised JavaScript origins: leave empty, this flow does not need one
- [ ] Copy the client ID and client secret

Back in Supabase:

- [ ] Authentication -> Sign In / Providers -> **Google: ON**, paste ID and secret
- [ ] Authentication -> **enable manual linking** (needed for the Settings connect/disconnect
      panel; without it `linkIdentity` fails at runtime with a confusing error)

- [ ] Tell me when stage 5 is done

## Stage 6 onward: mine

Stages 2 and 3 of the spec, shipped as one deploy: `signInWithGoogle`, the buttons, the
`/auth/callback` route outside `RequireAuth`, the Settings identities panel, and
`setFirstPassword`. Then the browser pass from the spec, **on a throwaway Google account
first**, including the one test this whole ordering exists for: an existing confirmed account
signing in with Google must see **its own** recipes.

## If you want to stop partway

Stages 1 to 4 are worth shipping **on their own**, even if Google never happens: they mean
password resets work, addresses are real, and "who is in this family" means something. Stage 5
is the optional part. Do not do 5 without 1 to 4.
