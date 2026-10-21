import { supabase } from "../../supabaseClient";
import type { GroupNumbers, StripNumbers } from "./types";

// EVERY call in this directory goes through .schema("kitchen"). These tables are not in the
// public schema, and PostgREST answers "The schema must be one of the following" without it.
// The hosted project also has to EXPOSE that schema by hand, which no migration does: see
// docs/OPERATIONS.md before blaming this file.
const kitchen = () => supabase.schema("kitchen");

/**
 * The numbers page for one group, or null when the caller is not served them.
 *
 * NULL IS NOT AN EMPTY GROUP. kitchen.group_numbers answers an owner or a chef with the
 * figures and everybody else with `{}`, so an empty object means "you are not served this"
 * and has to stay distinguishable from a group that simply has nothing in it yet. Collapsing
 * the two would tell a cook their group has done nothing, which is a different and false
 * statement.
 */
export async function groupNumbers(orgId: string): Promise<GroupNumbers | null> {
  const { data, error } = await kitchen().rpc("group_numbers", { p_org: orgId });
  if (error) throw new Error(error.message);
  if (data === null || typeof data !== "object" || Object.keys(data).length === 0) return null;
  return data as GroupNumbers;
}

export async function myGroupNumbers(): Promise<Record<string, StripNumbers>> {
  // No argument, deliberately: the function's subject is auth.uid(), so there is no id for a
  // caller to substitute and one request answers for every group they run.
  const { data, error } = await kitchen().rpc("my_group_numbers");
  if (error) throw new Error(error.message);
  return (data ?? {}) as Record<string, StripNumbers>;
}
