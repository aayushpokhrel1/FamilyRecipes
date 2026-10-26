import { Route, Routes } from "react-router-dom";
import AdminApp from "./App";
import RequireAuth from "../components/RequireAuth";
import RequireModerator from "./components/RequireModerator";
import SignIn from "./pages/SignIn";
import AuthCallback from "./pages/AuthCallback";
import Moderation from "./pages/Moderation";
import NotFound from "./pages/NotFound";

// RequireAuth is the family app's, reused on purpose exactly as the kitchen app reuses it: it
// holds the rule that the destination travels in the URL through safeNext rather than in
// router state, and that rule was learned twice in one week. A second copy would be a second
// place to get it wrong.
//
// It replaced this app's own RequireSession on 2026-10-26, and the reason it could is this
// file: RequireSession existed ONLY because there was no /signin on this host, so it sent a
// signed-out visitor to the family app's sign-in carrying the full URL they wanted. Now that
// the console has its own door, that cross-origin bounce is gone, and with it
// `safeReturnUrl`, which existed for that one hop.
//
// Most visitors never see the sign-in page at all. The session cookie is scoped to
// .enamelvault.com, so anyone signed in on either other app arrives here already signed in.
//
// THREE BANDS, and the band a route is in IS the security decision:
//
//   1. Outside everything: the two auth pages. You cannot be asked for a session on the page
//      whose job is to get you one.
//   2. The catch-all. Telling someone a page does not exist is not an action, and gating it
//      would send a signed-out visitor through sign-in to be told their link is dead.
//   3. Everything else: inside RequireAuth AND RequireModerator. There is no fourth band,
//      because there is no public document on this host and nothing here that does not need a
//      moderator.
//
// No terms gate, deliberately. This is not a consumer product and its only user is an operator;
// see the comment on RequireModerator for the full reasoning.
//
// src/admin/routes.guard.test.tsx reads this file and fails if any route escapes the gate.
export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route element={<AdminApp />}>
        <Route path="*" element={<NotFound />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireModerator>
                <Moderation />
              </RequireModerator>
            </RequireAuth>
          }
        />
      </Route>
    </Routes>
  );
}
