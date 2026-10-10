import { vi, test, expect } from "vitest";
vi.mock("../supabaseClient", () => ({
  supabase: { auth: {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
  }},
}));
import { signIn, signUp, signInWithGoogle } from "./auth";

test("signIn returns the user on success", async () => {
  const u = await signIn("a@b.dev", "pw");
  expect(u.id).toBe("u1");
});
test("signIn throws on error", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({ data: {}, error: { message: "bad" } });
  await expect(signIn("a@b.dev", "x")).rejects.toThrow("bad");
});

// The two doors that LEAVE this page, and the reason the destination is in the URL at all: a
// confirmation link is opened later, usually in another tab, and Google comes back through a
// full page load. React Router state is gone in both cases, so anything not in the URL is
// lost, and an invite link sent to someone with no account is exactly what gets lost. Found
// on production, 2026-10-10.
test("the confirmation email comes back to the invite, not to the home page", async () => {
  const { supabase } = await import("../supabaseClient");
  await signUp("a@b.dev", "pw", "A", "/join/abc123");
  const opts = (supabase.auth.signUp as any).mock.calls.at(-1)[0].options;
  expect(opts.emailRedirectTo).toContain("/auth/callback?next=%2Fjoin%2Fabc123");
});

test("Google comes back to the invite too", async () => {
  const { supabase } = await import("../supabaseClient");
  await signInWithGoogle("/join/abc123");
  const opts = (supabase.auth.signInWithOAuth as any).mock.calls.at(-1)[0].options;
  expect(opts.redirectTo).toContain("/auth/callback?next=%2Fjoin%2Fabc123");
});

test("a plain sign-in with nowhere to go back to keeps a bare callback URL", async () => {
  const { supabase } = await import("../supabaseClient");
  await signInWithGoogle();
  const opts = (supabase.auth.signInWithOAuth as any).mock.calls.at(-1)[0].options;
  expect(opts.redirectTo).toMatch(/\/auth\/callback$/);
});
