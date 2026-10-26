import { type ReactNode, useEffect, useState } from "react";
import { getMyProfile } from "../../lib/api/profile";
import Skeleton from "../../components/Skeleton";

/**
 * This app's gate. The family app has RequireAuth plus a terms gate; the kitchen app has
 * RequireAuth plus its own terms gate; this one has RequireAuth plus THIS.
 *
 * There is deliberately no terms gate here. This is not a consumer product and its only user is
 * an operator: there is nothing to consent to and nobody to record an acceptance against that
 * is not already recorded by the family app. What the other two apps' guards actually assert is
 * "no route that DOES something escapes the gate this app has", and the gate this app has is
 * the moderator check. `src/admin/routes.guard.test.tsx` holds that.
 *
 * IT ANSWERS "Not found", NOT "forbidden", and that is carried over from the page this replaced.
 * A non-moderator should not be able to confirm that a moderation console exists at this
 * address. The `admin` edge function answers 404 for the same reason.
 *
 * THE SERVER IS WHAT ENFORCES THIS. Every action behind here goes through the `admin` edge
 * function or a `security definer` RPC, each of which re-reads the flag from `profiles` with
 * the caller's own client so RLS authorises it. This component decides what to DRAW. If it were
 * ever the only check, the console would be one devtools edit away from being open.
 */
export default function RequireModerator({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "yes" | "no">("loading");

  useEffect(() => {
    let ignore = false;
    getMyProfile()
      .then((p) => {
        if (!ignore) setState(p.is_moderator ? "yes" : "no");
      })
      .catch(() => {
        // A failed profile read is not a moderator. Failing closed is the only safe direction
        // here, and the alternative (treat an error as "keep trying") would render the console
        // to someone whose flag we could not confirm.
        if (!ignore) setState("no");
      });
    return () => {
      ignore = true;
    };
  }, []);

  if (state === "loading") return <Skeleton shape="plate" count={3} />;
  if (state === "no") return <p>Not found</p>;
  return <>{children}</>;
}
