import { Link } from "react-router-dom";

// Without a catch-all route React Router matches nothing and renders an EMPTY tree: no
// header, no nav, no way out but the back button. That is what a typo or a stale link used
// to get, and it reads as a broken app rather than a wrong address.
//
// KNOWN CEILING, on purpose: this is a 200, not a 404. The Worker serves index.html for any
// unknown path, and the only way it could know this path is dead is to carry a copy of the
// route table, which is a second store of the same list and exactly the drift this project
// keeps paying for. A visitor gets the right page; a crawler gets the wrong status.
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
