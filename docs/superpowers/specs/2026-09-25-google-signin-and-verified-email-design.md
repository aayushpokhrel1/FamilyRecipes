# Signing in with Google, on top of a verified email

## Problem

Three things, from three different motivations:

1. **Signup friction loses people.** A family member who has to invent and remember a password
   often does not come back. One tap with Google removes the password entirely.
2. **Nobody knows whether an email address is real.** Confirmation is OFF on cloud Supabase, so
   an address is whatever was typed. Password resets go nowhere, and "who is in this family" is
   unverified.
3. **Its absence reads as unfinished.** A stated and legitimate reason.

Phone verification was considered and **deliberately dropped**: it needs an SMS provider and a
per-message cost, and no motivation survived scrutiny. Joining a family already works by invite
code, and there is no 2FA to support.

## The finding that fixes the ordering

Supabase links an OAuth identity to an existing account **only when that account's email is
already confirmed**. It refuses otherwise, on purpose, to prevent pre-account-takeover attacks.
(https://supabase.com/docs/guides/auth/auth-identity-linking)

Confirmation is currently off, so **every existing account has an unconfirmed email**. Shipping
Google before verification therefore produces this, on the very first try, to the owner of the
vault:

1. Tap "Sign in with Google" using the same address as the existing password account
2. Supabase declines to link, because that email was never confirmed
3. A second, empty account is created: no family, no recipes

"I signed in with Google and all our recipes are gone."

**So the ordering is not a preference, it is a constraint.** Email verification must be on, and
existing accounts must actually be confirmed, before Google reaches production.

## Decisions

1. **Verification first, Google second.** Ship in that order, with a gate between them.
2. **Rely on Supabase's automatic linking** rather than writing matching logic. Once emails are
   confirmed, same-email linking is the platform's job, and it is a job we should not
   re-implement.
3. **Manual linking in Settings** via `linkIdentity` / `unlinkIdentity`, which requires manual
   linking to be enabled in the project's auth configuration.
4. **A Google-only account needs a way to set a first password.** The existing `changePassword`
   re-authenticates with the current password before changing it, deliberately, and must not be
   weakened. It cannot serve an account that never had a password, so a separate path is needed.
5. **No phone.** See Out of scope.
6. **Existing accounts get confirmed directly, not through a re-verification flow.** There are a
   handful of real users. Building a bulk re-confirmation journey for them would be more code
   than the feature.

## Architecture

### Stage 1: email verification (no application code)

Infrastructure only, and all of it outside this repo:

- a sending domain, because the built-in sender is capped around 2 to 4 emails an hour and is
  documented as dev-only
- custom SMTP (Resend, Brevo, or SES)
- **Site URL set to the live origin**, or every confirmation link points at localhost
- email confirmation switched on

The frontend is already built for this and needs no change: `signUp` in `src/lib/api/auth.ts`
returns `{ user, session }`, and `SignUp.tsx` already shows a "check your email" panel when
there is no session. This was written in anticipation and has never been exercised.

**Gate before stage 2:** every existing account shows a confirmed email. Until that is true,
Google must not be enabled in production.

### Stage 2: sign in with Google

Config: a Google Cloud OAuth client, the provider enabled in Supabase with its client ID and
secret, and the redirect URL allowed.

Code, all small:

- `signInWithGoogle()` in `src/lib/api/auth.ts`, wrapping
  `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } })`
- a Google button on `SignIn.tsx` and `SignUp.tsx`
- a callback route at `/auth/callback`, rendered **outside `RequireAuth`**

**Why the callback route exists.** The client is created with default options, so
`detectSessionInUrl` and the PKCE flow are active and the code exchange happens automatically
wherever the redirect lands. But the exchange is asynchronous, and `RequireAuth` redirects the
moment it sees no session, so landing on a guarded route races the exchange and can bounce a
successful sign-in to `/signin`. `/recover` already sits outside the guard for the same class
of reason, and `routes.tsx` says so in a comment. The callback route waits for a session, then
navigates onward, and shows a failure plainly rather than silently returning to the form.

### Stage 3: connect Google to an existing account

A new `plate panel` section in `src/pages/Settings.tsx`, beside Account and Preferences, and a
small `src/lib/api/identities.ts`:

- `listIdentities()` wrapping `supabase.auth.getUserIdentities()`
- `linkGoogle()` wrapping `linkIdentity({ provider: "google" })`
- `unlinkGoogle(identity)` wrapping `unlinkIdentity(identity)`

The panel lists what is attached, offers Connect when Google is absent and Disconnect when it
is present.

**Lockout is prevented by the platform:** `unlinkIdentity` requires at least two linked
identities, so the last one cannot be removed. The UI must still explain that rather than
surfacing a raw error, because an unexplained failure on a security screen is alarming.

**Setting a first password.** A Google-only account has no password, so `changePassword` cannot
work for it: its re-authentication step has nothing to authenticate against. Add
`setFirstPassword(newPassword)` calling `updateUser({ password })` with no re-auth, shown ONLY
when the account has no email/password identity. This is safe for the same reason the recovery
flow is: the caller is already holding a valid session, and there is no existing password whose
knowledge could be proven. The distinction must be commented, because it looks like the exact
hole `changePassword` was written to close.

**Contrast:** Settings sections are `.plate`, which is cream. Any new note or label needs the
`.plate .vault-note` treatment, or it renders cream on cream and is invisible. That has already
shipped once on this page.

## Testing

Unit tests, mocking `../supabaseClient` in the style of `auth.test.ts`:

- `signInWithGoogle` passes the provider and a `redirectTo` pointing at `/auth/callback`
- the identities panel shows Connect when only an email identity exists, Disconnect when Google
  is present
- Disconnect is refused, with an explanation, when Google is the only identity
- `setFirstPassword` is offered only when no email/password identity exists
- `setFirstPassword` does NOT call `signInWithPassword` (it has no password to check), while
  `changePassword` still does. The existing re-auth test must keep passing.

**Browser pass, on a throwaway Google account, before trusting any of it:**

- a NEW Google account signs up and lands in the app with no family, and can create one
- an EXISTING confirmed account signs in with Google and sees **its own** recipes, which is the
  failure this whole ordering exists to prevent
- connect and disconnect from Settings, and the refusal when it is the only identity
- do the walk on a fresh account with no data first, since a doorway that only renders when
  something already exists has shipped on this project before

## Rollout

Strictly ordered, and stage 2 does not begin until the gate passes.

1. SMTP, sending domain, Site URL, confirmation on
2. **Gate:** confirm every existing account's email, and check it
3. Google Cloud client, provider enabled, manual linking enabled
4. Ship the code (stages 2 and 3 are one deploy; the Settings panel is useless without the
   provider configured)
5. Browser pass above, then tell the family

## Out of scope

- **Phone verification and phone login.** An SMS provider and a per-message cost, and no
  motivation survived. Invite codes already cover joining a family, and there is no 2FA.
- **Other providers.** Apple and Facebook are the same shape; nothing here blocks adding one,
  and none is wanted.
- **A bulk re-confirmation flow for existing users.** More code than the feature, for a handful
  of accounts. They get confirmed directly.
- **Account merging.** If someone has already created a duplicate account via some other route,
  merging two profiles' recipes is a different and much larger problem. Not now.
