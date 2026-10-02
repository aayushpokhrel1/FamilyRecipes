import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import FamilySwitcher from "./FamilySwitcher";
import { signOut } from "../lib/api/auth";
import { getMyProfile } from "../lib/api/profile";
import { useAuth } from "../context/AuthContext";

export default function AppLayout() {
  const navigate = useNavigate();
  const { userId } = useAuth();
  // The link is the ONLY way to reach /moderation: the route has no entry point anywhere
  // else, so before this a moderator had to remember the URL to find their own queue.
  //
  // This is a CONVENIENCE, not a permission. Hiding a link protects nothing, and the real
  // guard is elsewhere and stays there: the page re-checks is_moderator, and the report rows
  // are unreadable to anyone else under RLS. Someone who types the URL without the flag still
  // gets nothing, which is the behaviour a test pins.
  const [isModerator, setIsModerator] = useState(false);
  useEffect(() => {
    if (!userId) {
      setIsModerator(false);
      return;
    }
    let ignore = false;
    // A failure here must leave the link hidden rather than break the whole layout, which
    // wraps every signed-in page.
    getMyProfile()
      .then((p) => { if (!ignore) setIsModerator(!!p.is_moderator); })
      .catch(() => { if (!ignore) setIsModerator(false); });
    return () => { ignore = true; };
  }, [userId]);

  async function handleSignOut() {
    await signOut();
    navigate("/signin");
  }

  return (
    <div className="app">
      {/* First focusable thing on the page. Without it a keyboard or screen-reader user tabs
          through the whole nav on every single page before reaching the content. Visible only
          when focused, so it costs everyone else nothing. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <Link to="/">Family Recipes</Link>
        {/* A visitor arrives here from a shared recipe link. Everything in the signed-in nav
            would bounce them to /signin, so the public header offers the one thing that
            works: signing in. */}
        {userId ? (
          <>
            <nav aria-label="Main">
              <NavLink to="/" end>
                Recipes
              </NavLink>
              <NavLink to="/kitchen">My Kitchen</NavLink>
              <NavLink to="/potluck">Potluck</NavLink>
              {/* Static on purpose, and NOT conditional on having published. The page lives
                  at /cooks/<handle>, so linking there directly would mean fetching the
                  profile here and holding a handle that goes stale the moment Settings
                  changes it. /me redirects instead. */}
              <NavLink to="/me">My Profile</NavLink>
              <NavLink to="/families">Families</NavLink>
              <NavLink to="/settings">Settings</NavLink>
              {isModerator && <NavLink to="/moderation">Moderation</NavLink>}
            </nav>
            <FamilySwitcher />
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <nav aria-label="Main">
            <Link to="/signin" className="action">
              Sign in
            </Link>
          </nav>
        )}
      </header>
      <main className="app-main" id="main">
        <Outlet />
      </main>
    </div>
  );
}
