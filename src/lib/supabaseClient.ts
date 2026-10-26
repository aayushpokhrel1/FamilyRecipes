import { createClient } from "@supabase/supabase-js";
import { assertEnv } from "./assertEnv";
import { cookieStorage } from "./sessionCookie";

const { url, anonKey } = assertEnv(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ONE CLIENT, THREE APPS, and since 2026-10-26 one session across all three hosts.
//
// The session lives in a cookie on `.enamelvault.com` rather than in localStorage, because
// localStorage is per-origin and the family, kitchen and console apps are three origins. See
// src/lib/sessionCookie.ts for the security trade this makes and what pays for it.
export const supabase = createClient(url, anonKey, {
  auth: { storage: cookieStorage },
});
