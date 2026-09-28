import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import FamilySwitcher from "./FamilySwitcher";
import { signOut } from "../lib/api/auth";
import { useAuth } from "../context/AuthContext";

export default function AppLayout() {
  const navigate = useNavigate();
  const { userId } = useAuth();

  async function handleSignOut() {
    await signOut();
    navigate("/signin");
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/">Family Recipes</Link>
        {/* A visitor arrives here from a shared recipe link. Everything in the signed-in nav
            would bounce them to /signin, so the public header offers the one thing that
            works: signing in. */}
        {userId ? (
          <>
            <nav>
              <NavLink to="/" end>
                Recipes
              </NavLink>
              <NavLink to="/kitchen">My Kitchen</NavLink>
              <NavLink to="/potluck">Potluck</NavLink>
              <NavLink to="/families">Families</NavLink>
              <NavLink to="/settings">Settings</NavLink>
            </nav>
            <FamilySwitcher />
            <button type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </>
        ) : (
          <nav>
            <Link to="/signin" className="action">
              Sign in
            </Link>
          </nav>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
