import { Link, Outlet, useNavigate } from "react-router-dom";
import FamilySwitcher from "./FamilySwitcher";
import { signOut } from "../lib/api/auth";

export default function AppLayout() {
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/signin");
  }

  return (
    <div>
      <header>
        <Link to="/">Family Recipes</Link>
        <FamilySwitcher />
        <nav>
          <Link to="/">Recipes</Link>
          <Link to="/kitchen">My Kitchen</Link>
          <Link to="/families">Families</Link>
        </nav>
        <button type="button" onClick={handleSignOut}>
          Sign out
        </button>
      </header>
      <Outlet />
    </div>
  );
}
