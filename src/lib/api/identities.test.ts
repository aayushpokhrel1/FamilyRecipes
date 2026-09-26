import { vi, test, expect } from "vitest";

vi.mock("../supabaseClient", () => ({
  supabase: {
    auth: {
      getUserIdentities: vi.fn(),
      linkIdentity: vi.fn().mockResolvedValue({ error: null }),
      unlinkIdentity: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { email: "a@b.dev" } } }),
    },
  },
}));

import { hasProvider, listIdentities, linkGoogle, unlinkIdentity } from "./identities";
import { setFirstPassword, changePassword, signInWithGoogle } from "./auth";
import { supabase } from "../supabaseClient";

const email = { identity_id: "i1", provider: "email" } as never;
const google = { identity_id: "i2", provider: "google" } as never;

test("listIdentities returns the identities", async () => {
  (supabase.auth.getUserIdentities as never as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ data: { identities: [email, google] }, error: null });
  expect(await listIdentities()).toHaveLength(2);
});

test("listIdentities survives a response with no identities array", async () => {
  (supabase.auth.getUserIdentities as never as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ data: null, error: null });
  expect(await listIdentities()).toEqual([]);
});

test("listIdentities throws the supabase message", async () => {
  (supabase.auth.getUserIdentities as never as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ data: null, error: { message: "nope" } });
  await expect(listIdentities()).rejects.toThrow("nope");
});

test("hasProvider tells an email identity from a google one", () => {
  expect(hasProvider([email], "email")).toBe(true);
  expect(hasProvider([google], "email")).toBe(false);
  expect(hasProvider([email, google], "google")).toBe(true);
});

test("linkGoogle asks for the google provider", async () => {
  await linkGoogle();
  expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({ provider: "google" });
});

test("unlinkIdentity surfaces the platform's refusal to remove the last one", async () => {
  (supabase.auth.unlinkIdentity as never as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ error: { message: "User must have at least 1 identity" } });
  await expect(unlinkIdentity(google)).rejects.toThrow(/at least 1 identity/);
});

test("signInWithGoogle points the redirect at the callback route", async () => {
  await signInWithGoogle();
  expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
});

// The security-relevant pair. setFirstPassword exists for an account that has no
// password, so it has nothing to re-authenticate against; changePassword must keep
// proving the current password, because there IS one and skipping it would hand the
// account to anyone at an unlocked machine.
test("setFirstPassword does NOT re-authenticate", async () => {
  await setFirstPassword("new-password");
  expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "new-password" });
});

test("changePassword still DOES re-authenticate", async () => {
  (supabase.auth.signInWithPassword as never as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ error: null });
  await changePassword("old-password", "new-password");
  expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
    email: "a@b.dev",
    password: "old-password",
  });
});
