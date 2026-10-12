import { Link } from "react-router-dom";
import { CONTACT_EMAIL, OPERATOR } from "../../lib/legal";

// Rendered once in main.tsx, OUTSIDE the route tree, so it is on every page including the
// signed-out auth pages. That placement is the point, exactly as it is for the family app's
// footer: the terms and privacy links have to be reachable FROM THE SIGNUP FORM, and /signin
// and /signup sit outside the KitchenApp layout on purpose, so a footer inside that layout
// would not appear on them.
//
// No Help link, because this app has no help page, and no Cookies link, because it has no
// separate cookies page: the privacy page carries that section instead, and
// src/lib/browserStorage.test.ts fails the build if a cookie or a new storage key appears,
// which is the exact moment a consent banner would become mandatory.
//
// Only class names src/index.css actually defines. `site-footer` is the family footer's real
// class; the kitchen shell already shipped once with an invented `appbar`/`wordmark`/`muted`,
// which rendered as unstyled text and failed nothing.
export default function KitchenFooter() {
  return (
    <footer className="site-footer">
      <nav aria-label="Site information">
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
      </nav>
      <p>
        Enamel Vault for kitchens is run by {OPERATOR}, one person, not a company. Free while it
        is in development, no adverts, no tracking, no cookies.
      </p>
      <p>Your dishes belong to your business. Nothing here is public unless you publish it.</p>
    </footer>
  );
}
