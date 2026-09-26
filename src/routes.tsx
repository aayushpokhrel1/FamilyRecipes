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
import RecipeDetail from "./pages/RecipeDetail";
import RecipeEdit from "./pages/RecipeEdit";
import CookMode from "./pages/CookMode";
import MyKitchen from "./pages/MyKitchen";
import Cupboard from "./pages/Cupboard";
import MealPlanDetail from "./pages/MealPlanDetail";
import Settings from "./pages/Settings";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      {/* Outside RequireAuth on purpose: a recovery session is not a normal
          sign-in, and the guard would bounce the reset link to /signin. */}
      <Route path="/recover" element={<Recover />} />
      {/* Outside RequireAuth for a different reason than /recover: a FAILED Google
          sign-in comes back here with no session at all, and the guard would bounce
          it to /signin, throwing away the only explanation of what went wrong. */}
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<RecipeList />} />
        <Route path="families" element={<Families />} />
        <Route path="recipes/new" element={<RecipeCreate />} />
        <Route path="recipes/:id" element={<RecipeDetail />} />
        <Route path="recipes/:id/edit" element={<RecipeEdit />} />
        <Route path="recipes/:id/cook" element={<CookMode />} />
        <Route path="kitchen" element={<MyKitchen />} />
        {/* Above kitchen/:id deliberately. React Router ranks a static segment
            over a dynamic one, so this wins, but the ordering says so out loud
            rather than relying on the reader knowing that. */}
        <Route path="kitchen/cupboard" element={<Cupboard />} />
        <Route path="kitchen/:id" element={<MealPlanDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="join/:code" element={<JoinByCode />} />
      </Route>
    </Routes>
  );
}
