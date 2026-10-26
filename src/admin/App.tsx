import { Link, Outlet } from "react-router-dom";
import { signOut } from "../lib/api/auth";
import { useAuth } from "../context/AuthContext";

// The frame the console renders inside. Deliberately plain, and deliberately reusing the
// family app's tokens through index.css rather than inventing any: DESIGN.md is the single
// home for the visual system and a second palette would drift from it.
//
// ONLY CLASS NAMES index.css ACTUALLY DEFINES. A missing class fails nothing and renders
// unstyled, which the kitchen shell shipped once with an invented `appbar`/`wordmark`/`muted`.
// `app-header` is the real one.
export default function AdminApp() {
  const { userId } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/">Enamel Vault console</Link>
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
