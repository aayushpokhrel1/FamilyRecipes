import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

describe("follows", () => {
  let me: Awaited<ReturnType<typeof makeUser>>;
  let cook: Awaited<ReturnType<typeof makeUser>>;
  let quiet: Awaited<ReturnType<typeof makeUser>>;
  const anon = anonClient();
  // Unique per run: handle is UNIQUE, so a hardcoded one passes on a fresh database and then
  // silently fails the update on every rerun, leaving the cook unpublished and failing the
  // follow tests for a reason that has nothing to do with follows.
  const handle = `cook${Date.now()}`;

  beforeAll(async () => {
    me = await makeUser(`me-${Date.now()}@test.dev`);
    cook = await makeUser(`cook-${Date.now()}@test.dev`);
    quiet = await makeUser(`quiet-${Date.now()}@test.dev`);
    await admin.from("profiles").update({ handle, public_name: "A Cook" }).eq("id", cook.id);
  });

  it("lets you follow a published cook", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: cook.id });
    expect(error).toBeNull();
  });

  it("refuses a cook who has not published", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: quiet.id });
    expect(error?.code).toBe("42501");
  });

  it("refuses following yourself", async () => {
    const { error } = await me.client.from("follows")
      .insert({ follower_id: me.id, cook_id: me.id });
    // The check constraint fires regardless of RLS, so this is 23514 rather than 42501.
    expect(error).not.toBeNull();
  });

  it("refuses inserting a follow on someone else's behalf", async () => {
    const { error } = await cook.client.from("follows")
      .insert({ follower_id: me.id, cook_id: cook.id });
    expect(error?.code).toBe("42501");
  });

  it("does not let another user read your follows", async () => {
    const { data } = await cook.client.from("follows").select("cook_id").eq("follower_id", me.id);
    expect(data).toEqual([]);
  });

  it("does not let an anonymous visitor read follows at all", async () => {
    const { data } = await anon.from("follows").select("cook_id");
    expect(data).toEqual([]);
  });

  it("lets you unfollow", async () => {
    await me.client.from("follows").delete().eq("follower_id", me.id).eq("cook_id", cook.id);
    const { data } = await me.client.from("follows").select("cook_id").eq("follower_id", me.id);
    expect(data).toEqual([]);
  });
});
