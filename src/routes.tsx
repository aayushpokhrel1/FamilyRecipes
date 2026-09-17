import { Routes, Route } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import Families from "./pages/Families";
import JoinByCode from "./pages/JoinByCode";
import RecipeList from "./pages/RecipeList";

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
