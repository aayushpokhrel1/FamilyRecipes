import { type ReactNode, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import Skeleton from "../../components/Skeleton";
import { FAMILY_ORIGIN } from "../../lib/hosts";

/**
 * This app's stand-in for RequireAuth, and it exists for one reason: there is no sign-in page on
 * this host.
 *
 * The family app's RequireAuth sends a signed-out visitor to `/signin`, which here is not a
 * route, so they landed on the catch-all. That is honest but useless. This sends them to the
 * family app's sign-in instead, carrying where they were trying to go, so they come back.
 *
 * MOST VISITORS NEVER SEE THIS. The session cookie is scoped to `.enamelvault.com`, so anyone
 * already signed in on the family or kitchen app arrives here signed in and this component
 * renders its children immediately. It is the cold-start path only.
 *
 * `window.location.replace`, not `assign`: this app is not in the visitor's history in any
 * useful sense, and leaving it there means Back from the sign-in page bounces them straight
 * into the redirect again.
 */
export default function RequireSession({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth();

  useEffect(() => {
    if (loading || userId) return;
    // The FULL url, not the pathname: this is a cross-origin return, so the family app needs to
    // know which host to send them back to. safeReturnUrl on the other side is what refuses
    // anything that is not one of our own three origins.
    const back = window.location.href;
    window.location.replace(`${FAMILY_ORIGIN}/signin?next=${encodeURIComponent(back)}`);
  }, [loading, userId]);

  // While redirecting, and while the session is still being read, show the same skeleton rather
  // than a flash of "Not found". The redirect is a navigation, so this is the last thing the
  // page renders.
  if (loading || !userId) return <Skeleton shape="plate" count={3} />;
  return <>{children}</>;
}
