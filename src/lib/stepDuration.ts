// Finds durations written in a recipe step, so Cook Mode can offer a tap-to-start timer.
//
// Pure and dependency-free on purpose: this is the one piece of the timer feature that can be
// exhaustively tested from a table, and the table in stepDuration.test.ts IS the specification.
//
// THE UNIT MUST MATCH AS A WHOLE WORD. This is a correctness requirement, not a tidiness one:
// without the \b, "20 ml" and "500 mg" parse as twenty and five hundred MINUTES, and an
// ingredient quantity sitting in a step becomes a timer. Any new unit added below keeps the
// boundary.
//
// Anything vaguer than a written number is deliberately NOT recognised ("overnight", "until
// golden", "a couple of minutes"). A chip offering a duration the recipe never wrote is a
// confidently wrong timer, and wrong is worse than absent on a screen someone is trusting with
// their hands full.

export interface StepDuration {
  /** The phrase as written, so the chip reads in the recipe's own words. */
  label: string;
  seconds: number;
  /** Match position in the text. Used only to keep chips in reading order. */
  index: number;
}

const MAX_SECONDS = 24 * 60 * 60;

const HOUR = /^(h|hr|hrs|hour|hours)$/;
const MINUTE = /^(m|min|mins|minute|minutes)$/;
const SECOND = /^(s|sec|secs|second|seconds)$/;

function unitSeconds(unit: string): number | null {
  const u = unit.toLowerCase();
  if (HOUR.test(u)) return 3600;
  if (MINUTE.test(u)) return 60;
  if (SECOND.test(u)) return 1;
  return null;
}

// A number, optionally a range ("10-12", "10 to 12"), optionally a vulgar fraction
// ("1 1/2"), then a unit as a whole word, optionally followed by a second number and unit
// ("1 hour 30 minutes"). The worded singular "an hour" / "a minute" is a separate branch.
const NUMERIC = new RegExp(
  [
    "\\b(\\d+)",                       // 1: first number
    "(?:\\s*(?:-|\\u2013|to)\\s*(\\d+))?", // 2: optional range end
    "(?:\\s+(\\d+)\\s*/\\s*(\\d+))?",  // 3,4: optional fraction "1 1/2"
    "\\s*([a-z]+)\\b",                 // 5: unit
    "(?:\\s+(\\d+)\\s*([a-z]+)\\b)?",  // 6,7: optional second number and unit
  ].join(""),
  "gi",
);

// The qualifier group exists only to be REJECTED. "half an hour" contains "an hour", so
// without capturing the "half" this branch reads the tail of a phrase that is deliberately
// out of scope and invents a timer from it. "quarter of an hour" is the same shape.
const WORDED = /\b(?:(half|quarter)\s+(?:of\s+)?)?(an?)\s+(hour|minute|hours|minutes)\b/gi;

export function findDurations(text: string): StepDuration[] {
  if (!text) return [];
  const out: StepDuration[] = [];

  for (const m of text.matchAll(NUMERIC)) {
    const [, first, rangeEnd, fracNum, fracDen, unit, secondNum, secondUnit] = m;
    const base = unitSeconds(unit);
    if (base === null) continue;

    // A range rings at the LONGER end: ringing early on food that is not done sends
    // someone back to the pan, while ringing late is what every cook checks for anyway.
    let value = Number(rangeEnd ?? first);
    if (fracNum && fracDen && Number(fracDen) !== 0) {
      value = Number(first) + Number(fracNum) / Number(fracDen);
    }
    let seconds = Math.round(value * base);

    // "1 hour 30 minutes" is ONE timer, not two. Only accept the trailing pair when it is a
    // smaller unit than the first, so "20 minutes 3 eggs" does not absorb the eggs.
    let end = m.index + m[0].length;
    if (secondNum && secondUnit) {
      const secondBase = unitSeconds(secondUnit);
      if (secondBase !== null && secondBase < base) {
        seconds += Number(secondNum) * secondBase;
      } else {
        // Trim the trailing pair back off the label.
        end = m.index + m[0].indexOf(secondNum, String(first).length);
      }
    }

    if (seconds <= 0 || seconds > MAX_SECONDS) continue;
    out.push({ label: text.slice(m.index, end).trim(), seconds, index: m.index });
  }

  for (const m of text.matchAll(WORDED)) {
    // A worded fraction is out of scope, and this is the line that keeps it out.
    if (m[1]) continue;
    const base = unitSeconds(m[3]);
    if (base === null) continue;
    // "a couple of minutes" and "a few minutes" must not land here: the article is followed
    // directly by the unit in this branch, so they never match in the first place.
    out.push({ label: m[0], seconds: base, index: m.index });
  }

  return out.sort((a, b) => a.index - b.index);
}
