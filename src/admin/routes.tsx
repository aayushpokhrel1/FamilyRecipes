import { Route, Routes } from "react-router-dom";
import AdminApp from "./App";
import RequireAuth from "../components/RequireAuth";
import RequireModerator from "./components/RequireModerator";
import Moderation from "./pages/Moderation";
import NotFound from "./pages/NotFound";

// RequireAuth is the family app's, reused on purpose, exactly as the kitchen app reuses it: it
// holds the rule that the destination travels in the URL through safeNext rather than in router
// state, and that rule was learned twice in one week. A second copy would be a second place to
// get it wrong.
//
// THERE IS NO SIGN-IN PAGE IN THIS APP. RequireAuth sends a signed-out visitor to /signin, which
// on this host does not exist, so until the shared session lands (stage 3 of the design) you
// sign in on the family app and come back. That is a known gap for one commit and not an
// oversight; the design's stage 3 is what closes it.
//
// TWO BANDS, and the band a route is in IS the security decision:
//
//   1. The catch-all. Telling someone a page does not exist is not an action, and gating it
//      would be pointless here: this whole host is one gate.
//   2. Everything else: inside RequireAuth AND RequireModerator. There is no third band,
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
