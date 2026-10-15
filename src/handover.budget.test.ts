import { describe, expect, it } from "vitest";

// A LINE BUDGET FOR HANDOVER.md, because a doc asking nicely for brevity does not get it.
//
// That file is meant to hold current state only: the commit, the versions, the counts, what is
// half-done and what is next. It reached 1,365 lines once and began contradicting itself, and a
// superseded line in it caused real wrong work (a model swap was re-proposed that the same file
// recorded as already tried and rejected). It then reached 715 lines by 2026-10-15, almost
// entirely a narrative of past sessions, which `git log` already holds in more detail. Both
// times the rule was already written down, in CLAUDE.md and at the top of the file itself.
// **The failure mode is not ignorance, it is not re-reading**, which is this project's whole
// argument for a mechanical defence over a prose one.
//
// WHEN THIS FAILS: move content to its home (CLAUDE.md has the routing table) or delete the
// history. **Do not raise the budget.** Raising it is the one change that makes the guard
// pointless, and the number sits a little above a comfortable handover so that a failure means
// real bloat rather than a long day.
//
// Vite's import.meta.glob, not node:fs: tsconfig.app.json deliberately has no node types, and a
// static `?raw` import would FAIL THE BUILD on any machine without the file. HANDOVER.md is
// gitignored and local-only, so a fresh clone and CI genuinely have nothing to measure; a glob
// that matches nothing yields an empty record, which is how this skips there instead of failing
// for everyone who does not have an optional file.
const MATCHES = import.meta.glob("../HANDOVER.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const BUDGET = 200;
const handover: string | null = Object.values(MATCHES)[0] ?? null;

describe("HANDOVER.md", () => {
  it(`stays under ${BUDGET} lines, or holds something that belongs in a permanent doc`, () => {
    if (handover === null) return; // not this machine's file; see the comment above
    const lines = handover.split("\n").length;
    expect(
      lines,
      `HANDOVER.md is ${lines} lines, over the ${BUDGET}-line budget. Move content to its home ` +
        `(CLAUDE.md has the routing table) or delete the narrative; do not raise the budget. ` +
        `Run /update-docs for the sweep.`,
    ).toBeLessThanOrEqual(BUDGET);
  });

  it("does not grow a dated diary, which is the shape the budget is really about", () => {
    if (handover === null) return;
    // Two or more dated section headings is a diary rather than a state file. Dates in prose
    // are fine and often necessary; dates as STRUCTURE are the tell. "Where we are (date)" is
    // allowed, because that one IS the current state.
    const dated = (handover.match(/^#{2,3} .*\d{4}-\d{2}-\d{2}.*$/gm) ?? []).filter(
      (h) => !/^## Where we are/.test(h),
    );
    expect(
      dated,
      "HANDOVER.md has dated section headings, which is a diary. git log already holds it.",
    ).toHaveLength(0);
  });
});
