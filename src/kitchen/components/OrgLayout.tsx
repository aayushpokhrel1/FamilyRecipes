import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { myOrgs } from "../../lib/api/kitchen/orgs";

// The frame every page inside one kitchen group renders in, and the only way to get from
// Sites to Staff to Dishes.
//
// A LAYOUT ROUTE RATHER THAN A COMPONENT DROPPED INTO EACH PAGE, for the reason GatedLayout
// gives about the terms gate in this same folder: four copies of a nav is four chances to
// forget the fifth, and the page somebody adds next is the one that would lose it.
//
// The name is decoration and the links are the function, so a failed or slow myOrgs() must
// never cost you the navigation. The fallback text is "Your kitchens", which is a correct
// label for where that link actually goes, so the degraded state reads as deliberate rather
// than broken.
export default function OrgLayout() {
  const { id } = useParams();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    myOrgs()
      .then((orgs) => {
        if (live) setName(orgs.find((o) => o.id === id)?.name ?? null);
      })
      .catch(() => {
        // The group's name is the one thing here that needs the network. Losing it leaves
        // the links, which are what this component exists for.
        if (live) setName(null);
      });
    return () => {
      live = false;
    };
  }, [id]);

  // NavLink sets aria-current="page" on the active one by itself, which is the part that
  // matters for a screen reader; the class is only the visible half of the same fact.
  const mark = ({ isActive }: { isActive: boolean }) => (isActive ? "is-current" : undefined);

  return (
    <>
      <nav className="org-nav" aria-label="This kitchen group">
        <Link to="/">{name ?? "Your kitchens"}</Link>
        <NavLink to={`/orgs/${id}/sites`} className={mark}>
          Sites
        </NavLink>
        <NavLink to={`/orgs/${id}/staff`} className={mark}>
          Staff
        </NavLink>
        <NavLink to={`/orgs/${id}/dishes`} className={mark}>
          Dishes
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
