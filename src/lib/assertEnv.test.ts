import { describe, it, expect } from "vitest";
import { assertEnv } from "./assertEnv";

describe("assertEnv", () => {
  it("throws when URL is missing", () => {
    expect(() => assertEnv("", "key")).toThrow(/VITE_SUPABASE_URL/);
  });

  it("throws when anon key is missing", () => {
    expect(() => assertEnv("http://x", "")).toThrow(/VITE_SUPABASE_ANON_KEY/);
  });

  it("returns env vars when both are set", () => {
    const result = assertEnv("http://x", "key");
    expect(result).toEqual({ url: "http://x", anonKey: "key" });
  });
});
