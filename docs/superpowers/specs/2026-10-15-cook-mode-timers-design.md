# Cook Mode timers, from the step text

A duration written in a step ("simmer for 20 minutes") becomes a tap-to-start countdown that
keeps running while you use the rest of the app, and rings with a sound, an on-screen alarm and
a notification.

This is the last of the three Cook Mode ideas from 2026-09-29 and the one `PRODUCT.md` recorded
as wanting its own spec. The other two, reading the step aloud and voice input, stay deferred
with their reasons in `PRODUCT.md`.

## Why it is shaped this way

Four decisions were taken deliberately, and three of them are the reason this document exists
rather than a plan on its own.

**A timer outlives the screen that started it.** The requirement was that you can leave Cook
Mode to check the grocery list or answer a comment and come back to a running timer. That rules
out holding timer state in `CookMode.tsx`: React unmounts that page when you navigate, the
interval would die with it, and the timer would silently *resume* on your return rather than
having rung on time. A timer that is quiet precisely during the window you left the page is
worse than no timer. So the clock lives in a module, above React's lifecycle, and the display
mounts in `AppLayout` where every page can see it.

**It stores an end timestamp, never a remaining count.** Remaining time is always computed as
`endsAt - Date.now()`. This is what makes the feature correct across a reload, a hidden tab
whose timers the browser throttles to roughly once a minute, and a laptop that was asleep. A
late tick is then late to *announce* and never wrong about the number, and a tab that wakes to
find three timers already due rings all three, which is the right behaviour. Storing a
decrementing counter would have made every one of those cases silently wrong.

**Ringing with the browser fully closed is NOT in scope, and not for want of trying.** The
obvious answer, a Service Worker holding a timer, does not work: a Service Worker is terminated
when idle and any pending timer dies with it. The one web API that scheduled a notification
without a server, `TimestampTrigger` / `Notification.prototype.showTrigger`, was Chrome-only,
experimental, and has since been removed from Chromium; it never existed in Safari. The only
mechanism that genuinely rings with the browser closed is a server pushing at the scheduled
moment, which means Web Push: a service worker, a subscription per device, VAPID keys, a
`push_subscriptions` table with its own migration, RLS, grants and an `on delete` action, a send
edge function, and a cron to fire it. It would also drag in two of this repo's mechanical
guards, because a push endpoint is a third party that `Privacy.tsx` must name or
`supabase/processors.test.ts` fails the build, and a subscription is identifying data that both
account-deletion paths must erase or `supabase/deletion_parity.test.ts` fails.

That was weighed and deferred, not forgotten. For the actual use case, a phone propped on a
kitchen counter, the browser is open. The store is shaped so that push becomes an additional
notifier subscribing to the same ring event rather than a rewrite, if cooking with this proves
the gap matters.

**The parser refuses to guess.** It reads plain durations and ranges and nothing vaguer.
`overnight`, `until golden` and `a couple of minutes` yield no chip, because a chip offering a
number the recipe never wrote is a confidently wrong timer, and wrong is worse than absent on a
screen someone is trusting while their hands are full.

## The parser

`src/lib/stepDuration.ts`, pure, no imports.

```ts
export interface StepDuration { label: string; seconds: number; index: number; }
export function findDurations(text: string): StepDuration[];
```

Returns one entry per duration found, in the order they appear in the text. `label` is the
matched phrase as written, so the chip reads in the recipe's own words. `index` is the match
position, used only for ordering. A step with no duration returns `[]`.

Recognised:

| Written | Seconds |
| --- | --- |
| `20 minutes`, `20 mins`, `20 min` | 1200 |
| `45 seconds`, `45 secs`, `45 sec` | 45 |
| `1 hour`, `1 hr`, `2 hours` | 3600, 7200 |
| `1 hour 30 minutes`, `1 hr 30 min` | 5400 |
| `1 1/2 hours`, `2 1/2 hours` | 5400, 9000 |
| `an hour`, `a minute` | 3600, 60 |
| `10-12 minutes`, `10 to 12 minutes` | 720, the **longer** end |

A unit must match as a whole word. This is the one parser rule that is a correctness
requirement rather than a convenience: without it `20 ml` and `500 mg` match as twenty and five
hundred minutes, and an ingredient quantity sitting in a step becomes a timer.

The bare-letter forms `20m`, `1h` and `30s` ARE accepted, which an earlier draft of this spec
said they would not be. The reason given there does not survive contact with the regex: the
unit is captured greedily as `[a-z]+`, so `20 ml` captures `ml` and is rejected outright
rather than reading as a bare `m`. The same holds for `mg`, `cm`, `mm`, `kg` and `tsp`, and for
`3 medium onions`, which captures `medium`.

A range takes the longer end on purpose: ringing early on food that is not done sends someone
back to the pan, while ringing late is what every cook already expects to check for.

Explicitly not recognised, and each needs a test asserting an empty result so the line cannot
drift later: `overnight`, `until golden`, `until tender`, `a couple of minutes`, `a few
minutes`, `several hours`. A bare number with no unit (`add 3 eggs`) must also yield nothing,
which is the case most likely to produce a false chip.

Guard against absurd values: anything over 24 hours is ignored rather than clamped, since it is
far more likely to be a misparse than a real instruction.

## The store

`src/lib/cookTimers.ts`. A module-level store, deliberately not a React context value, because
the clock must survive the unmounting of the page that started it.

```ts
export interface CookTimer {
  id: string;            // crypto.randomUUID()
  recipeId: string;
  recipeTitle: string;   // so the strip reads sensibly from another page
  stepNumber: number;    // 1-based, matching ?step in CookMode
  label: string;         // the matched phrase, e.g. "20 minutes"
  endsAt: number;        // absolute epoch ms. NEVER a remaining count.
  ringing: boolean;
}

export function list(): CookTimer[];
export function start(input: Omit<CookTimer, "id" | "endsAt" | "ringing">
                      & { seconds: number }): CookTimer;
export function cancel(id: string): void;    // a running timer, stopped early
export function dismiss(id: string): void;   // a ringing timer, acknowledged
export function subscribe(fn: () => void): () => void;
```

One `setInterval` at 1000ms, owned by the module. It starts when the list becomes non-empty and
is cleared when it becomes empty, so an idle app runs no timer at all. Each tick compares every
`endsAt` against `Date.now()` and flips those that have passed to `ringing`, firing the alarm
once per timer.

`cancel` and `dismiss` are separate functions on purpose rather than one `remove`. They are the
same operation on the data and different events for the person: one is "I do not need this any
more", the other is "yes, I heard it". Keeping them apart means the strip cannot accidentally
offer "dismiss" for a timer that has not rung.

### Persistence

The whole list is written to one `localStorage` key, `cookTimers`, on every change, and read
once on module load.

On load, a timer whose `endsAt` is more than an hour in the past is **dropped, not rung**: a
timer that expired yesterday is not news, and a browser opened the next morning should not
greet someone with three alarms. A timer that expired within the hour is restored as `ringing`,
because that one probably did matter and was missed.

Every read and write is wrapped in try/catch and the store works with no storage at all, which
is the state in a private window or with site data blocked.

### The legal surface, which is not optional

`cookTimers` is a new storage key, and this repo guards that mechanically because
`src/pages/Cookies.tsx` claims the app needs no consent banner on the strength of listing
everything it stores. Two edits ship with the key or the build fails:

1. `KNOWN_KEYS` in `src/lib/browserStorage.test.ts` gains `cookTimers`, with a comment naming
   `src/lib/cookTimers.ts`.
2. The table in `src/pages/Cookies.tsx` gains a row: what it holds (a recipe id, a step number,
   a label and a timestamp), why it is strictly necessary (a timer has to survive leaving the
   page and reloading, which is the feature), and how long it lasts (until the timer is
   dismissed or cancelled).

Nothing leaves the browser. `Privacy.tsx` and `supabase/processors.test.ts` are untouched, and
there is no migration, no RLS and no edge function in this feature.

## The alarm

Three channels, in order of reliability. The first two always work; the third is a bonus.

**A sound, generated rather than shipped.** A short `AudioContext` oscillator beep, three
pulses. No audio file, which skips a binary in the repo, a decode, and any question about the
Worker's `Content-Security-Policy` (which has no `media-src` and so falls back to
`default-src 'self'`).

The part that is easy to get wrong: autoplay policy suppresses audio with no user gesture
behind it, silently. **The `AudioContext` is therefore created and resumed on the tap that
starts a timer**, which is a real gesture, and held for the rest of the session. Build it lazily
at ring time instead and the beep is blocked at exactly the moment it is needed, with no error.

**The on-screen alarm.** The ringing timer is visually distinct in the strip and carries its
dismiss control. This is the channel that cannot fail, and the one a denied notification
permission falls back to.

**A notification.** Requested on the first timer start, and only when
`Notification.permission === "default"`. The browser persists its own answer per origin, so once
it is `granted` or `denied` we never ask again, and no flag of ours is needed to remember that.
A denial costs no function. On iOS Safari notifications only reach a site installed to the Home
Screen, so this channel is absent there and the first two carry the feature.

## The strip

`src/components/CookTimers.tsx`, mounted inside `AppLayout` so every page that has the app shell
can show it. It subscribes to the store and **renders nothing at all when the list is empty**,
so it costs the four public document pages nothing.

Each entry shows the remaining time counting down, the recipe and step it came from, and a
cancel. A ringing entry is styled distinctly and offers dismiss instead.

It must use only class names `src/index.css` actually defines, adding what it needs there: a
missing class fails no test and renders unstyled, which the kitchen shell shipped once.

## The chips in Cook Mode

Under the step text, and **outside the step button**. The step text is itself the big Next
control, so a tappable duration inside it would nest interactive elements, which breaks
`src/lib/accessibility.test.ts` and would make the step itself unreliable to tap.

One chip per duration the parser finds, labelled with the phrase as written, tapping starts it.
A chip whose timer is already running for this recipe and step renders as running rather than
starting a duplicate.

A chip is a real `<button>` with an accessible name that includes the step, never a
`<div onClick>`.

## Error handling

- A URL-supplied step is already clamped in `CookMode.tsx`; timers inherit the clamped value and
  never store an out-of-range step.
- `localStorage` unavailable, full, or holding corrupt JSON: the store starts empty and the
  feature works for the session without persistence.
- `AudioContext` unavailable or refused: the strip and the notification still fire.
- `Notification` absent from the global, as it is in the test environment and in some embedded
  browsers: feature-detected, never assumed.
- A timer for a recipe that has since been deleted: the strip shows the stored title and the
  timer still rings. It is a countdown, not a live view of the recipe, so it must not fetch.

## Testing

| File | What it holds |
| --- | --- |
| `src/lib/stepDuration.test.ts` | The table of phrasings above, each asserted, plus every non-recognised phrase asserted to yield `[]`, plus the bare-number case and the over-24-hours guard |
| `src/lib/cookTimers.test.ts` | Fake timers. That `endsAt` arithmetic survives a simulated jump forward (the hidden-tab and sleeping-laptop case) and rings everything due at once; that a timer stale by over an hour is dropped on load while one stale by minutes is restored ringing; that the interval stops when the last timer goes; that a corrupt stored value starts the store empty |
| `src/pages/CookMode.test.tsx` | Chips render for a step with a duration and not for one without; a chip start puts a timer in the store; the chips are outside the step button |
| `src/lib/browserStorage.test.ts` | Already fails if `cookTimers` is not declared. It is the guard, not a new test |

Then the thing no suite can do. **Walk it in a browser on a fresh account at 375 and 1024**
before calling it done: start a timer, navigate away to the grocery list, confirm the strip
follows and the countdown is still right, let one ring, and check the sound actually plays.
Fourteen defects have shipped past a green suite and a clean typecheck on this project and been
caught by exactly this walk; the vault's `Green tests are not a browser pass` is the writeup.

## Out of scope

- Web Push, and anything that rings with the browser fully quit. Reasoned above.
- Reading the step aloud, and voice input. Deferred in `PRODUCT.md` with their reasons.
- Editing a timer's duration after starting it. Cancel and tap the chip again.
- A timer not derived from step text, started from an arbitrary number. No one asked for it, and
  the chip is the whole idea.
- `half an hour` and other worded fractions. Precise enough to be safe, but they sat in the
  wider parser option that was not the one chosen, so they stay out of the first build rather
  than being smuggled in. One table row each if they turn out to be missed.
- Any change to the `kitchen` app. It shares no data with the family app and has no Cook Mode.
