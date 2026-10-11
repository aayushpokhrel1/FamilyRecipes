import { supabase } from "../../supabaseClient";
import type { Invite, StaffRole } from "./types";

const kitchen = () => supabase.schema("kitchen");

export async function createInvite(
  orgId: string,
  role: StaffRole,
  siteId: string | null,
): Promise<string> {
  const { data, error } = await kitchen().rpc("create_invite", {
    p_org: orgId,
    p_role: role,
    // Explicitly null for a group-wide role. Omitting the key makes PostgREST complain that
    // no function matches the signature, which reads like the function is missing.
    p_site: siteId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function peekInvite(code: string): Promise<Invite | null> {
  const { data, error } = await kitchen().rpc("peek_invite", { p_code: code });
  if (error) throw new Error(error.message);
  // A table-returning function, so a miss is an EMPTY ARRAY rather than null. Reading [0]
  // without this is how a used link renders "undefined has invited you".
  const rows = (data ?? []) as Invite[];
  return rows.length ? rows[0] : null;
}

export async function acceptInvite(code: string, displayName: string): Promise<string> {
  const { data, error } = await kitchen().rpc("accept_invite", {
    p_code: code,
    p_display_name: displayName,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
