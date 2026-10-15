import { Link } from "react-router-dom";

// Without a catch-all route React Router matches nothing and renders an EMPTY tree: no
// header, no nav, no way out but the back button. That is what a typo or a stale link used
// to get, and it reads as a broken app rather than a wrong address.
//
// KNOWN CEILING, on purpose: this is a 200, not a 404, and it STAYS one. Two separate
// reasons, neither of which is "it would be hard":
//
//   1. For an unknown path like /cupboard the Worker would need the route table to know the
//      path is dead. That is a second store of the same list, which this repo does survive
//      elsewhere by pinning the copies with a test (see routes.terms.test.ts). It is simply
//      not worth it: nothing links to a typo, so nothing crawls one.
//   2. For the URL a crawler actually holds, a recipe that was public and is now unpublished,
//      a 404 is IMPOSSIBLE rather than merely unhelpful. enrichRecipePage reads with the anon
//      key, and a family-visibility recipe reads as null exactly as an unpublished one does.
//      404 on a null read would 404 every private recipe for the family that owns it. The 200
//      there is load-bearing, not an oversight.
//
// So a visitor gets the right page and a crawler gets a soft 404, which is the trade.
//
// Both classes matter: .prose styles the text and .plate carries the rule that recolours
// headings, and a .prose without a .plate puts bone headings on a bone background.
export default function NotFound() {
  return (
    <div className="prose plate">
      <h1>That page is not here</h1>
      <p>
        The address may be mistyped, or it may be a link to something that has since been
        taken down. Nothing is broken.
      </p>
      <p>
        <Link to="/">Back to the recipes</Link>, or read the <Link to="/help">help page</Link>.
      </p>
    </div>
  );
}
