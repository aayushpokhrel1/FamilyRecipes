import { Link } from "react-router-dom";
import { CONTACT_EMAIL, OPERATOR } from "../lib/legal";

// Rendered once in main.tsx, OUTSIDE the route tree, so it is on every page including the
// signed-out auth pages. That placement is the point: the terms and privacy links have to be
// reachable from the signup form, and a footer inside AppLayout would not be, because the auth
// pages deliberately render bare.
export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Site information">
        <Link to="/help">Help</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/cookies">Cookies</Link>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
      </nav>
      <p>
        Family Recipes is run by {OPERATOR}, one person, not a company. Free to use, no adverts,
        no tracking, no cookies.
      </p>
      <p>Recipes and photos belong to the cooks who added them.</p>
    </footer>
  );
}
