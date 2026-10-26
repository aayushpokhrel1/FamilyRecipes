import { Link } from "react-router-dom";
import { FAMILY_ORIGIN } from "../../lib/hosts";

/**
 * This app's own dead end, and it exists because reusing the family app's was wrong in a way
 * no test could see.
 *
 * The family NotFound offers "Back to the recipes" pointing at `/` and a link to `/help`.
 * Neither means anything here: `/help` is not a route in this app at all. Found by opening the
 * page, which is the only thing that has ever found this class of defect in this project.
 *
 * IT NO LONGER HANDLES THE SIGNED-OUT CASE, and that is the change of 2026-10-26 rather than
 * an omission. It used to say "sign in on the main app first", because RequireAuth sent a
 * visitor with no session to `/signin` and this host had no such route, so they landed here.
 * The console has its own sign-in now, so a signed-out visitor goes to the form instead and
 * never reaches this page. If that paragraph comes back, the routing has regressed.
 *
 * A redirect to `/` would be the tempting shorter answer and it is still a trap: `/` sends a
 * signed-out visitor to `/signin`, and a dead link looping through sign-in to land back here
 * is a loop, not a tidy-up.
 */
export default function NotFound() {
  return (
    <div className="plate panel">
      <h1>That page is not here</h1>
      <p>This is the moderation console, and it has one page.</p>
      <p>
        <Link to="/">Back to the console</Link>
      </p>
      {/* A plain anchor, NOT a Link: the destination is another host. */}
      <p>
        <a href={FAMILY_ORIGIN}>Go to Enamel Vault</a>
      </p>
    </div>
  );
}
