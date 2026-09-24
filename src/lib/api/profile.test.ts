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
import { updateDisplayName, updatePreferences } from "./profile";
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
