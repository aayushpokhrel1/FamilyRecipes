export function assertEnv(
  url: string | undefined,
  anonKey: string | undefined
): { url: string; anonKey: string } {
  if (!url) throw new Error("VITE_SUPABASE_URL is not set");
  if (!anonKey) throw new Error("VITE_SUPABASE_ANON_KEY is not set");
  // Strip any trailing slash: supabase-js appends /auth/v1/... so a trailing
  // slash produces a double slash the API rejects as "Invalid path".
  return { url: url.replace(/\/+$/, ""), anonKey };
}
