// src/lib/api/profile.test.ts
import { vi, test, expect } from "vitest";
const from = vi.fn();
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "me", email: "a@b.dev" } } });
const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: { id: "me" } }, error: null });
const updateUser = vi.fn().mockResolvedValue({ error: null });
vi.mock("../supabaseClient", () => ({ supabase: {
  from: (...a: any[]) => from(...a),
  auth: {
    getUser: (...a: any[]) => getUser(...a),
    signInWithPassword: (...a: any[]) => signInWithPassword(...a),
    updateUser: (...a: any[]) => updateUser(...a),
  },
}}));
import { updateDisplayName, updatePreferences, handleError, getBylines } from "./profile";
import { changePassword } from "./auth";

test("updatePreferences merges the patch into the stored preferences", async () => {
  let updated: any;
  from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { preferences: { units: "metric" } }, error: null }) }) }),
    update: (u: any) => { updated = u; return { eq: () => ({ error: null }) }; },
  }));
  const merged = await updatePreferences({ householdSize: 4 });
  expect(updated.preferences).toEqual({ units: "metric", householdSize: 4 });
  expect(merged).toEqual({ units: "metric", householdSize: 4 });
});

test("updateDisplayName rejects a blank name without writing", async () => {
  const update = vi.fn();
  from.mockImplementation(() => ({ update }));
  await expect(updateDisplayName("  ")).rejects.toThrow("Display name cannot be empty");
  expect(update).not.toHaveBeenCalled();
});

test("changePassword re-authenticates before updating the password", async () => {
  const calls: string[] = [];
  signInWithPassword.mockImplementationOnce(async () => { calls.push("signIn"); return { data: {}, error: null }; });
  updateUser.mockImplementationOnce(async () => { calls.push("updateUser"); return { error: null }; });
  await changePassword("old", "new");
  expect(calls).toEqual(["signIn", "updateUser"]);
});

test("changePassword throws and never updates when the current password is wrong", async () => {
  signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "bad" } });
  updateUser.mockClear();
  await expect(changePassword("wrong", "new")).rejects.toThrow("Current password is incorrect");
  expect(updateUser).not.toHaveBeenCalled();
});


describe("handleError", () => {
  it("accepts a plain lowercase handle", () => {
    expect(handleError("aayush")).toBeNull();
    expect(handleError("cook_2")).toBeNull();
  });
  it("rejects one that is too short or too long", () => {
    expect(handleError("ab")).toMatch(/3/);
    expect(handleError("a".repeat(31))).toMatch(/30/);
  });
  it("rejects uppercase rather than silently lowercasing it", () => {
    // Silently rewriting what someone typed means the handle they were shown is not the one
    // they got. Tell them instead.
    expect(handleError("Aayush")).toMatch(/lowercase/);
  });
  it("rejects characters that would need escaping in a URL", () => {
    expect(handleError("a b")).not.toBeNull();
    expect(handleError("a/b")).not.toBeNull();
    expect(handleError("a.b")).not.toBeNull();
  });
});

test("getBylines issues one query and keys the map by recipe_id", async () => {
  let ids: string[] = [];
  from.mockImplementation((table: string) => {
    expect(table).toBe("public_recipe_bylines");
    return { select: () => ({ in: (_c: string, v: string[]) => {
      ids = v;
      return { data: [
        { recipe_id: "r1", handle: "a", public_name: "A", family_name: "F1" },
        { recipe_id: "r2", handle: null, public_name: null, family_name: "F2" },
      ], error: null };
    } }) };
  });
  const map = await getBylines(["r1", "r2"]);
  expect(ids).toEqual(["r1", "r2"]);
  expect(from).toHaveBeenCalledTimes(1);
  expect(map.get("r1")?.public_name).toBe("A");
  // A recipe whose author never claimed a handle still gets a byline, via the left join.
  expect(map.get("r2")?.family_name).toBe("F2");
});

test("getBylines makes no request for an empty list", async () => {
  from.mockClear();
  expect((await getBylines([])).size).toBe(0);
  expect(from).not.toHaveBeenCalled();
});
