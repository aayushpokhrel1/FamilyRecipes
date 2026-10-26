import { Route, Routes } from "react-router-dom";
import AdminApp from "./App";
import RequireSession from "./components/RequireSession";
import RequireModerator from "./components/RequireModerator";
import Moderation from "./pages/Moderation";
import NotFound from "./pages/NotFound";

// RequireSession, NOT the family app's RequireAuth, and the difference is the whole reason it
// exists: there is no /signin on this host, so RequireAuth's redirect landed on the catch-all.
// RequireSession sends a signed-out visitor to the family app's sign-in carrying the full URL
// they wanted, and safeReturnUrl there is what refuses anything that is not one of our origins.
//
// Most visitors never reach it. The session cookie is scoped to .enamelvault.com, so anyone
// signed in on either other app arrives here already signed in.
//
// TWO BANDS, and the band a route is in IS the security decision:
//
//   1. The catch-all. Telling someone a page does not exist is not an action, and gating it
//      would be pointless here: this whole host is one gate.
//   2. Everything else: inside RequireSession AND RequireModerator. There is no third band,
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
            <RequireSession>
              <RequireModerator>
                <Moderation />
              </RequireModerator>
            </RequireSession>
          }
        />
      </Route>
    </Routes>
  );
}
