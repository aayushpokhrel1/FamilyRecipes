import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import AppLayout from "./components/AppLayout";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Recover from "./pages/Recover";
import AuthCallback from "./pages/AuthCallback";
import Families from "./pages/Families";
import JoinByCode from "./pages/JoinByCode";
import RecipeList from "./pages/RecipeList";
import RecipeCreate from "./pages/RecipeCreate";
import Drafts from "./pages/Drafts";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeEdit from "./pages/RecipeEdit";
import CookMode from "./pages/CookMode";
import CookPage from "./pages/CookPage";
import MyKitchen from "./pages/MyKitchen";
import Cupboard from "./pages/Cupboard";
import MealPlanDetail from "./pages/MealPlanDetail";
import MyProfile from "./pages/MyProfile";
import Settings from "./pages/Settings";
import Potluck from "./pages/Potluck";
import Moderation from "./pages/Moderation";
import Terms from "./pages/Terms";
import TermsGate from "./components/TermsGate";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      {/* Public, beside /signin: the gate links here, and someone deciding whether to
          sign up must be able to read the terms first. */}
      <Route path="/terms" element={<Terms />} />
      <Route path="/signup" element={<SignUp />} />
      {/* Outside RequireAuth on purpose: a recovery session is not a normal
          sign-in, and the guard would bounce the reset link to /signin. */}
      <Route path="/recover" element={<Recover />} />
      {/* Outside RequireAuth for a different reason than /recover: a FAILED Google
          sign-in comes back here with no session at all, and the guard would bounce
          it to /signin, throwing away the only explanation of what went wrong. */}
      <Route path="/auth/callback" element={<AuthCallback />} />
      {/* Public, and outside RequireAuth for the same family of reasons as /recover above:
          a published recipe must be readable with no session. The Worker already injects
          OpenGraph tags for /recipes/:id, so guarding this route meant every shared link
          advertised a page that answered with a sign-in wall.
          Only these two are public. recipes/:id/edit and recipes/:id/cook stay guarded. */}
      <Route element={<AppLayout />}>
        <Route path="recipes/:id" element={<RecipeDetail />} />
        <Route path="cooks/:handle" element={<CookPage />} />
      </Route>
      <Route
        element={
          <RequireAuth>
            <TermsGate>
              <AppLayout />
            </TermsGate>
          </RequireAuth>
        }
      >
        <Route index element={<RecipeList />} />
        <Route path="families" element={<Families />} />
        <Route path="recipes/new" element={<RecipeCreate />} />
        {/* Guarded, in the same group as recipes/new and NOT in the public group above.
            A draft is private to its author, so it must never sit beside recipes/:id
            and cooks/:handle. */}
        <Route path="drafts" element={<Drafts />} />
        <Route path="recipes/:id/edit" element={<RecipeEdit />} />
        <Route path="recipes/:id/cook" element={<CookMode />} />
        {/* Guarded on purpose, unlike recipes/:id and cooks/:handle above. Signed in now,
            public later is one line here; public now, signed in later does not un-cache what
            crawlers already took. This is a discovery brake and NOT a privacy boundary: anon
            can still read public rows through the API, which is what makes the public recipe
            pages and the OpenGraph previews work. */}
        <Route path="potluck" element={<Potluck />} />
        {/* Deliberately absent from the nav. The page checks is_moderator itself, so the
            route is safe to exist for everyone; hiding the link is a courtesy, not the
            permission. */}
        <Route path="moderation" element={<Moderation />} />
        <Route path="kitchen" element={<MyKitchen />} />
        {/* Above kitchen/:id deliberately. React Router ranks a static segment
            over a dynamic one, so this wins, but the ordering says so out loud
            rather than relying on the reader knowing that. */}
        <Route path="kitchen/cupboard" element={<Cupboard />} />
        <Route path="kitchen/:id" element={<MealPlanDetail />} />
        {/* A signpost, not a page of its own: it redirects to /cooks/<handle>, which keeps
            one canonical public URL. Guarded, because it reads YOUR profile. */}
        <Route path="me" element={<MyProfile />} />
        <Route path="settings" element={<Settings />} />
        <Route path="join/:code" element={<JoinByCode />} />
      </Route>
    </Routes>
  );
}
