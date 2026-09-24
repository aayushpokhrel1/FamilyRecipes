// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SB_URL!;
const ANON = process.env.SB_ANON_KEY!;
const SERVICE = process.env.SB_SERVICE_KEY!;

// jsdom leaks supabase-js auth sessions between clients, hence the node
// environment above and persistSession:false here.
function client() {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

describe("pantry_items RLS", () => {
  let familyA: string;
  let outsider: ReturnType<typeof client>;

  beforeAll(async () => {
    const mk = async (email: string) => {
      const { data } = await admin.auth.admin.createUser({
        email, password: "password123", email_confirm: true,
      });
      const c = client();
      await c.auth.signInWithPassword({ email, password: "password123" });
      return { id: data!.user!.id, c };
    };
    const owner = await mk(`owner-${Date.now()}@local.dev`);
    const other = await mk(`other-${Date.now()}@local.dev`);
    outsider = other.c;

    const { data: fam } = await owner.c.from("families")
      .insert({ name: "Pantry test", created_by: owner.id }).select("id").single();
    familyA = fam!.id;
    await admin.from("pantry_items")
      .insert({ family_id: familyA, key: "rice", label: "Rice", kind: "keep", state: "have" });
  });

  it("hides another family's cupboard", async () => {
    const { data } = await outsider.from("pantry_items").select("id").eq("family_id", familyA);
    expect(data).toEqual([]);
  });

  it("refuses a write into another family's cupboard", async () => {
    const { error } = await outsider.from("pantry_items")
      .insert({ family_id: familyA, key: "salt", label: "Salt" });
    expect(error).not.toBeNull();
  });

  it("defaults an existing staple row to keep/have", async () => {
    const { data } = await admin.from("pantry_items")
      .select("kind,state,expires_on").eq("family_id", familyA).eq("key", "rice").single();
    expect(data).toMatchObject({ kind: "keep", state: "have", expires_on: null });
  });
});
