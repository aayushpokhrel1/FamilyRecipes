import { FAMILY_ORIGIN } from "../../lib/hosts";

/**
 * This app's own dead end, and it exists because reusing the family app's was wrong in a way
 * no test could see.
 *
 * The family NotFound offers "Back to the recipes" pointing at `/` and a link to `/help`.
 * Neither means anything here: `/` on this host bounces a signed-out visitor straight back to
 * this page, and `/help` is not a route in this app at all. Found by opening the page, which is
 * the only thing that has ever found this class of defect in this project.
 *
 * IT ALSO HANDLES THE SIGNED-OUT CASE, which is the common way to arrive. RequireAuth sends a
 * visitor with no session to `/signin`, and this host has no such route, so they land here. Until
 * the shared session lands (stage 3 of the design) signing in happens on the family app, and
 * saying so is better than letting them read "that page is not here" and conclude the console is
 * broken.
 *
 * A redirect to `/` would be the tempting shorter answer and it is a trap: `/` sends a
 * signed-out visitor to `/signin`, which lands here, which would redirect to `/`. That is an
 * infinite loop, not a tidy-up.
 */
export default function NotFound() {
  return (
    <div className="plate panel">
      <h1>That page is not here</h1>
      <p>
        This is the moderation console, and it has one page. If you were signing in, do that on
        the main app first and then come back.
      </p>
      <p>
        <a href={FAMILY_ORIGIN}>Go to Enamel Vault</a>
      </p>
    </div>
  );
}
