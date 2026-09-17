import { Routes, Route } from "react-router-dom";
import App from "./App";
import RequireAuth from "./components/RequireAuth";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<SignIn />} />
      <Route path="/signup" element={<SignUp />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <App />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
