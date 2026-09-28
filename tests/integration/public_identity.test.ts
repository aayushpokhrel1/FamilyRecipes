import { describe, it, expect, beforeAll } from "vitest";
import { admin, makeUser, anonClient } from "./helpers";

describe("public identity", () => {
  let cookId: string;
  let familyId: string;
  let publicRecipeId: string;
  const anon = anonClient();
  // Unique per run. handle is UNIQUE, so a hardcoded one passes on a fresh database and then
  // silently fails the update on every rerun, leaving handle null and failing the byline test
  // for a reason that has nothing to do with the byline.
  const handle = `cook${Date.now()}`;

  beforeAll(async () => {
    const cook = await makeUser(`cook-${Date.now()}@test.dev`);
    cookId = cook.id;
    // Families are made with the admin client and two inserts, which is how every existing
    // integration test does it. There is no create_family_with_owner RPC; the only family
    // RPC is join_family_by_code.
    const { data: family } = await admin.from("families")
      .insert({ name: "Pokhrel", created_by: cookId }).select().single();
    familyId = family!.id;
    await admin.from("family_members")
      .insert({ family_id: familyId, user_id: cookId, role: "owner" });
    const { data: recipe } = await cook.client.from("recipes")
      .insert({ family_id: familyId, author_id: cookId, title: "Momo", visibility: "public" })
      .select("id").single();
    publicRecipeId = (recipe as { id: string }).id;
    await admin.from("profiles")
      .update({ handle, public_name: "Aayush", bio: "Cooks momo." })
      .eq("id", cookId);
  });

  it("lets a stranger read a published cook from the view", async () => {
    const { data } = await anon.from("public_cooks").select("handle,public_name,bio")
      .eq("handle", handle).single();
    expect(data).toMatchObject({ handle, public_name: "Aayush" });
  });

  it("never lets a stranger read profiles directly", async () => {
    // display_name and preferences must not be reachable. RLS gives anon no policy on
    // profiles at all, so this is an empty result rather than an error.
    const { data } = await anon.from("profiles").select("id,display_name").eq("id", cookId);
    expect(data).toEqual([]);
  });

  it("hides cooks who have not claimed a handle", async () => {
    const quiet = await makeUser(`quiet-${Date.now()}@test.dev`);
    const { data } = await anon.from("public_cooks").select("id").eq("id", quiet.id);
    expect(data).toEqual([]);
  });

  it("gives a stranger the byline for a public recipe", async () => {
    const { data } = await anon.from("public_recipe_bylines")
      .select("handle,public_name,family_name").eq("recipe_id", publicRecipeId).single();
    expect(data).toMatchObject({ public_name: "Aayush", family_name: "Pokhrel" });
  });

  it("never lets a stranger read families directly", async () => {
    const { data } = await anon.from("families").select("name").eq("id", familyId);
    expect(data).toEqual([]);
  });
  // These two exercise the avatars storage policy with RAW FETCH, the same HTTP calls
  // worker/index.ts makes, rather than the supabase-js storage client.
  //
  // The client's upload(..., new Blob(["x"])) HANGS INDEFINITELY in CI (proven: it timed out
  // at 5s, then still timed out after being given 30s) while passing on Windows locally. That
  // made the tests untrustworthy without explaining anything. Raw fetch is what the Worker
  // does in production anyway, so this tests the real path and cannot hang on client
  // internals.
  const storage = `${process.env.SB_URL}/storage/v1`;
  const svc = {
    apikey: process.env.SB_SERVICE_KEY!,
    Authorization: `Bearer ${process.env.SB_SERVICE_KEY}`,
  };
  const anonHeaders = {
    apikey: process.env.SB_ANON_KEY!,
    Authorization: `Bearer ${process.env.SB_ANON_KEY}`,
  };

  async function putAvatar(path: string) {
    const res = await fetch(`${storage}/object/avatars/${path}`, {
      method: "POST",
      headers: { ...svc, "Content-Type": "image/png" },
      body: "x",
    });
    // The object must actually exist, or "cannot sign" below would pass for the wrong reason.
    expect(res.ok).toBe(true);
  }

  // Exactly what serveAvatar does: sign as the ANON role. A 200 with a signedURL is the proof
  // the policy allows it; anything else is the proof it does not.
  async function signAsAnon(path: string) {
    const res = await fetch(`${storage}/object/sign/avatars/${path}`, {
      method: "POST",
      headers: { ...anonHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    return res;
  }

  it("lets a stranger sign the avatar of a published cook", async () => {
    await putAvatar(`${cookId}/a.png`);
    const res = await signAsAnon(`${cookId}/a.png`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { signedURL?: string };
    expect(body.signedURL).toBeTruthy();
  });

  it("does not let a stranger sign the avatar of a cook with no handle", async () => {
    const quiet = await makeUser(`quiet-av-${Date.now()}@test.dev`);
    await putAvatar(`${quiet.id}/a.png`);
    const res = await signAsAnon(`${quiet.id}/a.png`);
    // The Worker turns any non-2xx here into its own 404, so a published and an unpublished
    // cook are indistinguishable to a caller.
    expect(res.ok).toBe(false);
  });
});
