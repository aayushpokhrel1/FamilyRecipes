import { Link } from "react-router-dom";

// The kitchen app's own, deliberately not the family app's. Importing that one would pull a
// family page into this app, which supabase/kitchen_seal.test.ts fails on, and it would send
// a chef to /help, a route that does not exist on this host.
//
// The family page carries a note about serving a 200 rather than a 404. It does not apply
// here: this whole host is noindex, nofollow in both the meta tag and an X-Robots-Tag header
// the Worker sends, so no crawler ever sees this page or its status.
export default function NotFound() {
  return (
    <div className="prose plate">
      <h1>That page is not here</h1>
      <p>
        The address may be mistyped, or it may point at a kitchen, site or dish you no longer
        have access to. Nothing is broken.
      </p>
      <p>
        <Link to="/">Back to your kitchens</Link>.
      </p>
    </div>
  );
}
