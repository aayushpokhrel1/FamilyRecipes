import { Link } from "react-router-dom";

// The kitchen app's own, deliberately not the family app's. Importing that one would pull a
// family page into this app, which supabase/kitchen_seal.test.ts fails on, and it would send
// a chef to /help, a route that does not exist on this host.
//
// Same known ceiling as the family page: this renders a 200, because telling the Worker which
// paths are real would mean a second copy of the route table.
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
