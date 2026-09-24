import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import FamilySwitcher from "./FamilySwitcher";
import { signOut } from "../lib/api/auth";

export default function AppLayout() {
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/signin");
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/">Family Recipes</Link>
        <nav>
          <NavLink to="/" end>
            Recipes
          </NavLink>
          <NavLink to="/kitchen">My Kitchen</NavLink>
          <NavLink to="/families">Families</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <FamilySwitcher />
        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
