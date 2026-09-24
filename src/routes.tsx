import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import AppLayout from "./components/AppLayout";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Recover from "./pages/Recover";
import Families from "./pages/Families";
import JoinByCode from "./pages/JoinByCode";
import RecipeList from "./pages/RecipeList";
import RecipeCreate from "./pages/RecipeCreate";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeEdit from "./pages/RecipeEdit";
import CookMode from "./pages/CookMode";
import MyKitchen from "./pages/MyKitchen";
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
        <Route path="kitchen/:id" element={<MealPlanDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="join/:code" element={<JoinByCode />} />
      </Route>
    </Routes>
  );
}
