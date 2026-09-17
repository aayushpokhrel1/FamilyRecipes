import { createClient } from "@supabase/supabase-js";
import { assertEnv } from "./assertEnv";

const { url, anonKey } = assertEnv(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export const supabase = createClient(url, anonKey);
