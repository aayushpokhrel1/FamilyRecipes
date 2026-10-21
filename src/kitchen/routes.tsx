import { Route, Routes } from "react-router-dom";
import KitchenApp from "./App";
import RequireAuth from "../components/RequireAuth";
import GatedLayout from "./components/GatedLayout";
import OrgLayout from "./components/OrgLayout";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import AuthCallback from "./pages/AuthCallback";
import Recover from "./pages/Recover";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Dashboard from "./pages/Dashboard";
import NewOrg from "./pages/NewOrg";
import Sites from "./pages/Sites";
import Staff from "./pages/Staff";
import Dishes from "./pages/Dishes";
import DishDetail from "./pages/DishDetail";
import Numbers from "./pages/Numbers";
import OrgSettings from "./pages/OrgSettings";
import JoinByLink from "./pages/JoinByLink";
import NotFound from "./pages/NotFound";

// RequireAuth is the family app's, reused on purpose: it holds the rule that the destination
// travels in the URL through safeNext rather than in router state, and that rule was learned
// twice in one week. A second copy would be a second place to get it wrong.
//
// THREE BANDS, and the band a route is in IS the security decision:
//
//   1. Outside everything: the auth pages. You cannot accept terms before you have an account
//      for the acceptance to be recorded against.
//   2. Inside KitchenApp, outside GatedLayout: /terms and /privacy. A notice you can only read
//      after consenting is not a notice, which is why the family app keeps its four public
//      documents outside its gate too. They stay inside the layout so they keep the header and
//      the footer.
//   3. Inside GatedLayout: everything that DOES something.
//
// /join/:code is OUTSIDE RequireAuth because the whole point is that it names the org to
// somebody who has no account yet. It asks for a session only when they accept. It is still
// INSIDE the gate, because joining a group is an action, and the family app learned that one
// the hard way: moving its join route out of RequireAuth moved it out of TermsGate as well.
//
// src/kitchen/routes.terms.test.tsx reads this file and fails if an action route escapes.
export default function KitchenRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* Band 1 with the other auth pages, for the family app's reason: a recovery session is
          not a normal sign-in, and a guard would bounce the reset link to /signin. */}
      <Route path="/recover" element={<Recover />} />
      <Route element={<KitchenApp />}>
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        {/* Band 2 with the documents, not band 3. A dead link is not an action, so gating it
            would send a signed-out visitor through sign-in to be told the page does not
            exist. Inside KitchenApp, so the header and footer come back. */}
        <Route path="*" element={<NotFound />} />
        <Route element={<GatedLayout />}>
          <Route path="/join/:code" element={<JoinByLink />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route
            path="/orgs/new"
            element={
              <RequireAuth>
                <NewOrg />
              </RequireAuth>
            }
          />
          {/* One layout for everything inside a group, so the nav cannot be forgotten on the
              page somebody adds next, and so RequireAuth is stated once rather than four
              times. /orgs/new stays outside it: there is no group yet to navigate. */}
          <Route
            path="/orgs/:id"
            element={
              <RequireAuth>
                <OrgLayout />
              </RequireAuth>
            }
          >
            <Route path="sites" element={<Sites />} />
            <Route path="staff" element={<Staff />} />
            <Route path="dishes" element={<Dishes />} />
            <Route path="dishes/:dishId" element={<DishDetail />} />
            <Route path="numbers" element={<Numbers />} />
            <Route path="settings" element={<OrgSettings />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
