import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Families from "./pages/Families";
import JoinByCode from "./pages/JoinByCode";
import RecipeList from "./pages/RecipeList";
import RecipeCreate from "./pages/RecipeCreate";
import RecipeDetail from "./pages/RecipeDetail";
import RecipeEdit from "./pages/RecipeEdit";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RecipeList />
          </RequireAuth>
        }
      />
      <Route
        path="/recipes/new"
        element={
          <RequireAuth>
            <RecipeCreate />
          </RequireAuth>
        }
      />
      <Route
        path="/recipes/:id"
        element={
          <RequireAuth>
            <RecipeDetail />
          </RequireAuth>
        }
      />
      <Route
        path="/recipes/:id/edit"
        element={
          <RequireAuth>
            <RecipeEdit />
          </RequireAuth>
        }
      />
      <Route
        path="/families"
        element={
          <RequireAuth>
            <Families />
          </RequireAuth>
        }
      />
      <Route
        path="/join/:code"
        element={
          <RequireAuth>
            <JoinByCode />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
