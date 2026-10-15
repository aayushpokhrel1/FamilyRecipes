# Cook Mode: what a person needs while their hands are busy

Written 2026-10-15, before building, from a walk of the real screen and Aayush naming the
friction he actually hits.

## Start here: what Cook Mode ALREADY does

`PRODUCT.md` called it "a plain list" and floated two ideas from that description. Both were
answering a screen that does not exist, so this spec starts by correcting the record.

`src/pages/CookMode.tsx` today shows **one step at a time**, with Previous/Next and left/right
arrow keys, holds a **screen wake lock** so the phone does not sleep mid-cook, has a
**collapsible ingredient panel** with a portions stepper that scales quantities, and a **cook
log** that offers to mark the staples that recipe used as "out" in the cupboard.

So the two ideas in `PRODUCT.md` are both mis-premised and are NOT built here:

- *"The recipe stays visible on the side rather than scrolling away"* describes a scrolling
  list. Nothing scrolls away; one step fills the screen.
- *"Hovering an ingredient shows its scaled proportion"* needs a pointer, and cooking is the
  one activity that reliably has no mouse. The panel already shows scaled quantities. The
  useful half of the idea is "I want the amount next to the step without asking for it", and
  that survives as change 2 below, always visible instead of on hover.

`.cook-step` is already `clamp(1.9rem, 5vw, 3rem)`, so "make the text bigger for a propped-up
phone" is also already done.

## The friction, in Aayush's words

Three, all confirmed against the real screen:

1. **Cannot advance hands-free.** Next is a normal button needing a clean fingertip. With
   dough or oil on your hands you stop, wipe, tap, and carry on.
2. **The step and its ingredients are never both on screen.** To recall "how much salt" you
   toggle the panel, which renders the WHOLE list ABOVE the step and pushes the step off the
   bottom, read it, then toggle it shut.
3. **Lost my place.** The screen locks, or you back out, and it returns to step 1.

## The four changes

### 1. The step is the Next target

The step text becomes a full-width, full-height tappable area that advances. A knuckle, a
wrist or the side of a hand all work; a clean fingertip stops being a precondition.

Previous demotes to a small control at the edge, because going back is rare and an easy
accidental Previous is worse than a slightly awkward deliberate one. Swipe left/right maps to
the same two actions. The arrow keys stay.

On the LAST step the tap target does nothing rather than wrapping to the start, matching the
existing disabled Next.

**Accessibility is not optional here** (`src/lib/accessibility.test.ts` enforces it): the tap
area is a real `<button>` with an accessible name, not a `<div onClick>`.

### 2. This step's ingredients, under this step

Under the current step, list only the ingredients that step mentions, with quantities already
scaled by the portions factor.

**The matching rule**, which is the only interesting part: run `normalizeItem` over each
ingredient's name and look for the result in the step's text, normalized the same way. One
place decides it, a new pure helper beside `groupIngredients.ts`, so it is unit-testable
without rendering anything.

**When a step matches nothing, show nothing.** No guessing and no fallback to the whole list:
a wrong ingredient under a step is worse than none, because the full list is one tap away and
is still the complete reference. Recipes written as prose ("add the rest and simmer") will
often match nothing, and that is the correct outcome rather than a bug.

### 3. The full ingredient panel moves beside the step, never above it

The existing "Show ingredients" toggle keeps its job as the complete reference. What changes
is where it renders.

- **Wide screens**: `.cook` becomes a two-column grid when the panel is open, step and panel
  side by side, mirroring `.recipe-body`'s existing `minmax(0, 300px) minmax(0, 1fr)` shape.
- **Narrow screens**: one column, and the panel goes **BELOW** the step. The 720px breakpoint
  that `.recipe-body` already uses.

The rule worth writing down: **the panel is never above the step.** On a phone there is no
"side", so the only way to stop it pushing the step off the bottom is to put it underneath.
Moving it to the side and forgetting the phone would fix the complaint only on the device
nobody cooks from.

### 4. The step lives in the URL

`?step=3`, read on mount and written on every move.

**Not `localStorage`.** Three reasons, in order: this repo already has the rule that state
which must survive a round trip goes in the URL (`src/lib/nextPath.ts`); a new storage key
must be added to `KNOWN_KEYS` in `src/lib/browserStorage.test.ts` and justified as strictly
necessary, which drags in the Cookies page; and the URL survives reload, back/forward and
sharing for free.

Out-of-range or non-numeric values clamp into range rather than erroring, since a URL is
user-editable input and this is a trust boundary like any other.

### 5. Tick an ingredient off as you add it

Tap an ingredient, in either the inline list or the panel, to strike it through. It answers
the one question the screen cannot answer today: "did I already put the salt in?"

**Deliberately NOT persisted.** It is per-cook, not per-recipe: it resets when you leave, and
it writes nothing to the database. Persisting it would mean a half-ticked list greeting you
next time, which is worse than starting clean.

## Deferred, with the reason

- **Timers from the step text** ("simmer for 20 minutes" → tap to start). The highest-value
  idea for real cooking and the biggest build: a duration parser, a timer that survives
  navigating between steps, and a sound. It earns its own spec. Recorded in `PRODUCT.md`.
- **Read the step aloud** (`speechSynthesis`). Cheap and needs no permission, but it is
  output-only: you still tap to advance, so it does not fix friction 1. Recorded in
  `PRODUCT.md`.
- **Voice input** ("next"). The genuinely hands-free answer, and the most expensive: no
  speech API exists anywhere in `src/` today, it needs a permission prompt, and a noisy
  kitchen is its worst case. Revisit only if the big tap target proves not to be enough.

## Testing

Per change, and each one must be seen to fail first:

| Change | The test |
| --- | --- |
| 1 | Clicking the step advances; on the last step it does not. The target is a button with a name, not a `<div onClick>` |
| 2 | A step naming an ingredient shows it with the SCALED quantity; a step naming none shows nothing |
| 3 | A source-reading or computed-style check that the panel is not rendered above the step |
| 4 | Mounting at `?step=2` opens step 3; moving updates the URL; `?step=99` and `?step=abc` clamp rather than throw |
| 5 | Tapping an ingredient strikes it through; leaving and returning clears it |

Then a browser walk, on the real screen at both widths, because this project has eleven
defects that shipped past a green suite and were found by looking.

## Out of scope

Anything outside `src/pages/CookMode.tsx`, its new matching helper, and the `.cook` rules in
`src/index.css`. No database change, no API change, no new dependency.
