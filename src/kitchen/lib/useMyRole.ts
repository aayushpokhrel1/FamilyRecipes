import { useEffect, useState } from "react";
import { myRole } from "../../lib/api/kitchen/orgs";
import type { StaffRole } from "../../lib/api/kitchen/types";

/**
 * The viewer's role in one org, for deciding what to SHOW.
 *
 * Never for deciding what is ALLOWED: every rule is a policy or a definer function in the
 * database, and this hook only stops the page offering a button whose refusal the person
 * cannot act on. If this hook and the database ever disagree, the database is right.
 */
export function useMyRole(orgId: string): { role: StaffRole | null; loading: boolean } {
  const [role, setRole] = useState<StaffRole | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    myRole(orgId)
      .then((r) => live && setRole(r))
      .catch(() => live && setRole(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [orgId]);
  return { role, loading };
}

export const canWriteDishes = (role: StaffRole | null) => role === "owner" || role === "chef";
