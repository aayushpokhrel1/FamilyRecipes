import { Link, Outlet } from "react-router-dom";

// The frame every signed-in kitchen page renders inside. Deliberately plain: it reuses the
// family app's tokens through index.css and invents no new ones, because DESIGN.md is the
// single home for the visual system and a second palette would drift from it.
export default function KitchenApp() {
  return (
    <div className="site">
      <header className="appbar">
        <Link to="/" className="wordmark">
          Enamel Vault <span className="muted">for kitchens</span>
        </Link>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
