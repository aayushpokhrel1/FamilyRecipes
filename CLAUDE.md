# Working in this repo

## Where things are written down

**Before adding anything to `HANDOVER.md`, ask: will this still be true in a month?**
If yes, it belongs in a permanent doc below, not in the handover. This file exists because every
session was putting everything in `HANDOVER.md` until it reached 1,365 lines and started
contradicting itself, which caused real wrong work: a superseded line led to re-proposing a
model swap the same file recorded as already tried and rejected.

| Write it in | When it is |
| --- | --- |
| `README.md` | What the app is, what it does, the stack, links to everything else |
| `PRODUCT.md` | Product truth: who it is for, decisions, roadmap, what is deferred **and why** |
| `DESIGN.md` | The visual system: tokens, type, colour, component patterns |
| `docs/OPERATIONS.md` | Running, verifying, CI, deploying, secrets, monitoring, environment traps, latent landmines |
| `docs/LESSONS.md` | An engineering rule the project paid for. "We learned X the hard way" |
| `docs/superpowers/specs/` | The design of one feature, written before building it |
| `HANDOVER.md` | **Only** current state: commit, versions, test counts, what is half-done, what is next |
| nowhere | A dated narrative of what you did today. `git log` already holds it, in detail |

`HANDOVER.md` is gitignored and local-only, so nothing durable may live there: a fresh clone or
another machine would never see it.

**Updating docs means making them TRUE, not just appending what shipped.** Correct or strike a
stale claim where it sits rather than adding a newer entry beneath it, because the next reader
may hit the old one first. Cross-check every number (deployed version, test count, head commit)
against reality rather than trusting the file.

When asked to "update the docs", sweep all of them, not the one you happen to have open.

## Project rules

- **All Supabase access lives in `src/lib/api/`.** Nothing outside it imports the client. This
  is the portability seam for a future Node/Express + Postgres backend.
- **Verify with `npx tsc -b && npm test`**, not `tsc --noEmit`. DB or migration changes also
  need `npx supabase db reset` (requires Docker).
- **Apply a migration to cloud BEFORE the frontend that needs it.** A frontend commit and its
  migration are not one change: Cloudflare deploys one automatically and Supabase deploys
  neither. Getting this backwards broke every recipe save on production once already.
- **The edge function is never deployed automatically** — always
  `npx supabase functions deploy extract-recipe`. `ACTIVE` means deployed, not runnable.
- **Work on `master`** (solo project). Branch only to let CI gate something risky first.
- **Read `docs/LESSONS.md` before a big change** and `docs/OPERATIONS.md` before any deploy.
  Most entries there name a bug that recurred *after* its lesson was first written down.
