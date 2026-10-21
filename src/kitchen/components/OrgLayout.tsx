import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useParams } from "react-router-dom";
import { myOrgs } from "../../lib/api/kitchen/orgs";
import { recordKitchenVisit } from "../../lib/api/kitchen/visit";

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
  const location = useLocation();
  const [name, setName] = useState<string | null>(null);

  // The only place in the kitchen app a visit is recorded, because this is the one layout
  // every page inside a group renders in, which is the same reason the nav lives here.
  useEffect(() => {
    if (!id) return;
    recordKitchenVisit(id, location.pathname);
  }, [id, location.pathname]);

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
        {/* The three sections wrap as ONE group rather than individually. Without this span
            a narrow screen broke the row wherever it ran out of room, which at 375 left
            "Dishes" stranded alone on a third line under the other two. Wrapping the set
            keeps the name on one line and the sections together on the next, at every width
            and with no breakpoint to maintain. */}
        <span className="org-nav-links">
          <NavLink to={`/orgs/${id}/sites`} className={mark}>
            Sites
          </NavLink>
          <NavLink to={`/orgs/${id}/staff`} className={mark}>
            Staff
          </NavLink>
          <NavLink to={`/orgs/${id}/dishes`} className={mark}>
            Dishes
          </NavLink>
          <NavLink to={`/orgs/${id}/numbers`} className={mark}>
            Numbers
          </NavLink>
          <NavLink to={`/orgs/${id}/settings`} className={mark}>
            Settings
          </NavLink>
        </span>
      </nav>
      <Outlet />
    </>
  );
}
