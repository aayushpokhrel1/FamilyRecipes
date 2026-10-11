import { supabase } from "../../supabaseClient";
import type { Org, Site, StaffMember, StaffRole } from "./types";

// EVERY call in this directory goes through .schema("kitchen"). These tables are not in the
// public schema, and PostgREST answers "The schema must be one of the following" without it.
// The hosted project also has to EXPOSE that schema by hand, which no migration does: see
// docs/OPERATIONS.md before blaming this file.
const kitchen = () => supabase.schema("kitchen");

export async function createOrg(name: string, displayName: string): Promise<string> {
  // One RPC, not an insert plus an insert: the org and its owner row must appear together or
  // not at all, or the org can be administered by nobody.
  const { data, error } = await kitchen().rpc("create_org", {
    p_name: name,
    p_display_name: displayName,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function myOrgs(): Promise<Org[]> {
  // No filter: the orgs_staff_read policy already answers in terms of what the caller may
  // see, which is the whole point of putting the rule in the database.
  const { data, error } = await kitchen().from("orgs").select("id,name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Org[];
}

export async function addSite(orgId: string, name: string): Promise<string> {
  const { data, error } = await kitchen().rpc("add_site", { p_org: orgId, p_name: name });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function listSites(orgId: string): Promise<Site[]> {
  const { data, error } = await kitchen()
    .from("sites")
    .select("id,org_id,name")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Site[];
}

export async function listStaff(orgId: string): Promise<StaffMember[]> {
  const { data, error } = await kitchen()
    .from("staff")
    .select("user_id,role,site_id,display_name")
    .eq("org_id", orgId)
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as StaffMember[];
}

export async function myRole(orgId: string): Promise<StaffRole | null> {
  const { data, error } = await kitchen().rpc("staff_role", { p_org: orgId });
  if (error) throw new Error(error.message);
  return (data as StaffRole) ?? null;
}
