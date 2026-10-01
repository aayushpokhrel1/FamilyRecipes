import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { getMyProfile } from "../lib/api/profile";
import Skeleton from "../components/Skeleton";

// `/me` exists so the HEADER can be a static link. The public page lives at /cooks/<handle>,
// and the handle is on the profile, so a nav that linked there directly would have to fetch
// the profile in AppLayout, keep it for the whole session, and then go stale the moment
// someone publishes or unpublishes in Settings. This redirects instead: one fetch, only when
// clicked, never stale, and /cooks/<handle> stays the one canonical shareable URL.
export default function MyProfile() {
  const [handle, setHandle] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let ignore = false;
    getMyProfile()
      .then((p) => { if (!ignore) setHandle(p.handle); })
      // A failed lookup reads as "not published" rather than an error: the recovery is the
      // same either way, and it is the one thing this page can actually offer.
      .catch(() => { if (!ignore) setHandle(null); });
    return () => { ignore = true; };
  }, []);

  if (handle === undefined) return <Skeleton shape="plate" count={2} />;
  // replace, not push: /me is a signpost, so Back must go where you came from rather than
  // bouncing you through the redirect again.
  if (handle) return <Navigate to={"/cooks/" + handle} replace />;

  // Unpublished cooks reach this instead of the link being hidden from the nav. Hiding it
  // would mean the feature is invisible to exactly the people who have not found it yet.
  return (
    <section className="plate">
      <h1>Your public page</h1>
      <p className="vault-note">
        You have not published a profile yet. Claiming a handle in Settings gives you a page
        other cooks can open, and lets your public recipes carry your name.
      </p>
      <Link className="action" to="/settings">Go to Settings</Link>
    </section>
  );
}
