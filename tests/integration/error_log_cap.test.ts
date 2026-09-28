import { describe, it, expect } from "vitest";
import { admin, anonClient } from "./helpers";

// error_log has NO select policy by design, so row counts here go through the admin client.
// An anon insert must never chain .select(): that makes it INSERT ... RETURNING, which needs
// read permission and fails with 42501 for reasons that have nothing to do with the cap.
// That exact mistake produced a false "anon cannot write to error_log" result during design.
//
// ORDER MATTERS IN THIS FILE, and that is the point rather than a smell. The cap is global
// and per-minute, so the flood test necessarily suppresses everything after it for the rest
// of that minute. The honest-single-error case therefore has to run first, on a quiet
// minute, and the suppression it causes is pinned as its own test below.
describe("error_log rate limit", () => {
  it("records an ordinary single failure", async () => {
    const anon = anonClient();
    const context = `single-${Date.now()}`;
    const { error } = await anon.from("error_log").insert({ context, message: "one" });
    expect(error).toBeNull();
    const { count } = await admin.from("error_log")
      .select("id", { count: "exact", head: true }).eq("context", context);
    // A cap that also silenced honest single errors would make the whole monitoring feature
    // useless while looking like it worked. This matters more than the cap itself.
    expect(count).toBe(1);
  });

  it("drops rows past the cap without failing the caller", async () => {
    const anon = anonClient();
    const context = `cap-${Date.now()}`;
    const rows = Array.from({ length: 150 }, () => ({ context, message: "flood" }));
    const { error } = await anon.from("error_log").insert(rows);
    expect(error).toBeNull();

    const { count } = await admin.from("error_log")
      .select("id", { count: "exact", head: true }).eq("context", context);
    expect(count).toBeLessThanOrEqual(100);
    expect(count).toBeGreaterThan(0);
  });

  it("suppresses further reports for the rest of the minute, the accepted tradeoff", async () => {
    // Runs immediately after the flood above, so the window is still full. A global cap has
    // no per-caller identity to key on (anon has no user_id by design), so a flood buys the
    // flooder up to 60 seconds of silence. That is strictly better than an unbounded table
    // and it self-heals, but it is a real weakness and is pinned here so nobody discovers it
    // during an incident. The fix, if it ever matters: per-IP limiting at an edge function.
    const anon = anonClient();
    const context = `suppressed-${Date.now()}`;
    const { error } = await anon.from("error_log").insert({ context, message: "lost" });
    expect(error).toBeNull();
    const { count } = await admin.from("error_log")
      .select("id", { count: "exact", head: true }).eq("context", context);
    expect(count).toBe(0);
  });
});
