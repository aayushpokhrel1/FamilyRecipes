import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../index.css";
import { AuthProvider } from "../context/AuthContext";
import KitchenRoutes from "./routes";

// AuthProvider is SHARED, and that is deliberate: one login serves both products, and after
// 2026-10-11 the auth module it uses imports no family module. There is no FamilyProvider
// here and there must never be one.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <KitchenRoutes />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
