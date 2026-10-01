// The cook-facing wording for a failed model call. No Deno or DOM specifics so it runs
// unchanged under vitest (Node) and the Deno edge runtime, the same arrangement as
// retry.ts, jsonld.ts and htmlText.ts.

// What the COOK sees. The provider's own error body is for the logs: a QuotaFailure object on
// screen in the middle of adding a recipe tells them nothing they can act on, and every one of
// these states has a human answer, which is usually "type it in instead".
export function humanModelError(status: number): string {
  if (status === 429) {
    return "The recipe assistant has hit its limit for the moment. Wait a minute and try again, or type the recipe in by hand.";
  }
  if (status === 503 || status === 502 || status === 504) {
    return "The recipe assistant is busy right now. Try again in a moment, or type the recipe in by hand.";
  }
  if (status === 401 || status === 403) {
    return "The recipe assistant is not set up correctly. This one is not your fault: the key needs looking at.";
  }
  return "The recipe assistant could not read that. Try again, or type the recipe in by hand.";
}

