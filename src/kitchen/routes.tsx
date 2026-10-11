import { Route, Routes } from "react-router-dom";
import KitchenApp from "./App";
import RequireAuth from "../components/RequireAuth";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import NewOrg from "./pages/NewOrg";
import Sites from "./pages/Sites";
import Staff from "./pages/Staff";
import JoinByLink from "./pages/JoinByLink";

// RequireAuth is the family app's, reused on purpose: it holds the rule that the destination
// travels in the URL through safeNext rather than in router state, and that rule was learned
// twice in one week. A second copy would be a second place to get it wrong.
//
// /join/:code is OUTSIDE RequireAuth because the whole point is that it names the org to
// somebody who has no account yet. It asks for a session only when they accept.
export default function KitchenRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<KitchenApp />}>
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
      </Route>
    </Routes>
  );
}
