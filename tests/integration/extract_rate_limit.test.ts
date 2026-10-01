// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { admin, anonClient, makeUser } from "./helpers";

// extract_log has NO policy by design, so the only way in is claim_extraction, and the only
// way to inspect it is the admin client. Every call here goes through client.rpc, because a
// direct insert would be testing a door that does not exist.
//
// ORDER MATTERS IN THIS FILE, and that is the point rather than a smell. The cap is
// per-minute, so the flood test necessarily suppresses that user for the rest of the minute.
// The honest-single-extraction case therefore has to run first, on a quiet minute, and the
// per-user test after it proves the suppression is scoped to one cook rather than global.
describe("extract rate limit", () => {
  // The cap counts rows in the last minute, so these tests are only meaningful starting from
  // an empty window. Without this they pass on a fresh database and fail whenever the file is
  // run twice inside a minute, which is the same re-runnability trap the error_log tests hit.
  // admin bypasses RLS, and extract_log is a local/CI-only table in these runs.
  let cook: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(async () => {
    cook = await makeUser(`extract-${Date.now()}@t.dev`);
    await admin.from("extract_log").delete().eq("user_id", cook.id);
  });

  it("allows an ordinary single extraction", async () => {
    const { data, error } = await cook.client.rpc("claim_extraction");
    expect(error).toBeNull();
    // A cap that also blocked honest single use would be worse than no cap at all, because
    // the feature would look broken while the limit looked like it worked.
    expect(data).toMatchObject({ allowed: true });
  });

  it("refuses the eleventh call inside a minute", async () => {
    // The single call above already spent one of the ten, so nine more fill the window.
    for (let i = 0; i < 9; i++) {
      const { data } = await cook.client.rpc("claim_extraction");
      expect(data).toMatchObject({ allowed: true });
    }
    const { data, error } = await cook.client.rpc("claim_extraction");
    expect(error).toBeNull();
    expect(data).toMatchObject({ allowed: false, scope: "minute" });
    expect((data as any).retry_after_seconds).toBeGreaterThan(0);
  });

  it("limits per user, so a second cook is still allowed", async () => {
    // This is the property that makes this different from the global cap in 0024, and the
    // whole reason it is worth having: one cook exhausting their budget must not silence
    // anyone else. The first cook is blocked by the test above and still is here.
    const other = await makeUser(`extract-other-${Date.now()}@t.dev`);
    await admin.from("extract_log").delete().eq("user_id", other.id);
    const { data, error } = await other.client.rpc("claim_extraction");
    expect(error).toBeNull();
    expect(data).toMatchObject({ allowed: true });
  });

  it("refuses a signed-out caller", async () => {
    // anon has no execute grant, so this is an error rather than a row. A client with no
    // session is what a stranger on the internet is, and it must not be able to spend a
    // model call.
    const anon = anonClient();
    const { data, error } = await anon.rpc("claim_extraction");
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    // The code matters, not just the presence of an error. Before the migration existed this
    // test passed on PGRST202 ("no such function"), which proves nothing about the grant:
    // it was green for the same reason the other three were red. 42501 is a REFUSAL.
    expect(error?.code).toBe("42501");
  });
});
