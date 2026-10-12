import { Link, Outlet } from "react-router-dom";
import { signOut } from "../lib/api/auth";
import { useAuth } from "../context/AuthContext";

// The frame the kitchen pages render inside. NOT only the signed-in ones, which it was until
// the legal pages arrived: `/terms` and `/privacy` sit inside this layout and outside the
// terms gate, so a signed-out stranger renders here too, and the "Sign out" button below is
// conditional for that reason rather than as a nicety.
//
// Deliberately plain: it reuses the family app's tokens through index.css and invents no new
// ones, because DESIGN.md is the single home for the visual system and a second palette would
// drift from it.
export default function KitchenApp() {
  const { userId } = useAuth();
  // No `site` wrapper here any more: it lives in main.tsx so that it can also hold the
  // footer, which has to appear on the auth pages this layout never renders.
  return (
    <>
      {/* `app-header` is the family app's real class, and the classes this file first used
          (`appbar`, `wordmark`, `muted`) do not exist in index.css at all, so the header
          rendered as unstyled text. Found by opening the page, not by a test: nothing fails
          when a class name is simply absent. Only use class names that index.css defines. */}
      <header className="app-header">
        <Link to="/">Enamel Vault for kitchens</Link>
        {/* Plan 2 shipped with no way out at all: switching accounts meant clearing browser
            storage by hand. No forgetPhotoUrls here, deliberately: that is the family app's
            cache and this app may not import its modules. */}
        {userId && (
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
