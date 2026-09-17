import { vi, test, expect, beforeEach } from "vitest";
vi.mock("../supabaseClient", () => ({
  supabase: { auth: {
    signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: "u1" } }, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  }},
}));
import { signIn, signOut } from "./auth";

test("signIn returns the user on success", async () => {
  const u = await signIn("a@b.dev", "pw");
  expect(u.id).toBe("u1");
});
test("signIn throws on error", async () => {
  const { supabase } = await import("../supabaseClient");
  (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({ data: {}, error: { message: "bad" } });
  await expect(signIn("a@b.dev", "x")).rejects.toThrow("bad");
});
