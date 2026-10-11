import { Link, Outlet } from "react-router-dom";

// The frame every signed-in kitchen page renders inside. Deliberately plain: it reuses the
// family app's tokens through index.css and invents no new ones, because DESIGN.md is the
// single home for the visual system and a second palette would drift from it.
export default function KitchenApp() {
  return (
    <div className="site">
      {/* `app-header` is the family app's real class, and the classes this file first used
          (`appbar`, `wordmark`, `muted`) do not exist in index.css at all, so the header
          rendered as unstyled text. Found by opening the page, not by a test: nothing fails
          when a class name is simply absent. Only use class names that index.css defines. */}
      <header className="app-header">
        <Link to="/">Enamel Vault for kitchens</Link>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
