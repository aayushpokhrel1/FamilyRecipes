import { Route, Routes } from "react-router-dom";
import KitchenApp from "./App";
import RequireAuth from "../components/RequireAuth";
import GatedLayout from "./components/GatedLayout";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import AuthCallback from "./pages/AuthCallback";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Dashboard from "./pages/Dashboard";
import NewOrg from "./pages/NewOrg";
import Sites from "./pages/Sites";
import Staff from "./pages/Staff";
import Dishes from "./pages/Dishes";
import DishDetail from "./pages/DishDetail";
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
          <Route
            path="/orgs/:id/sites"
            element={
              <RequireAuth>
                <Sites />
              </RequireAuth>
            }
          />
          <Route
            path="/orgs/:id/staff"
            element={
              <RequireAuth>
                <Staff />
              </RequireAuth>
            }
          />
          <Route
            path="/orgs/:id/dishes"
            element={
              <RequireAuth>
                <Dishes />
              </RequireAuth>
            }
          />
          <Route
            path="/orgs/:id/dishes/:dishId"
            element={
              <RequireAuth>
                <DishDetail />
              </RequireAuth>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
