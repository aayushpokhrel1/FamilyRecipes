import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "../index.css";
import { AuthProvider } from "../context/AuthContext";
import AdminRoutes from "./routes";

// AuthProvider is SHARED, the same one both other apps use: one login serves all three.
//
// There is no FamilyProvider here and there must never be one. The console acts ACROSS
// families rather than inside one, and an active-family context would be a question this app
// has no business asking.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* `site` is the shared wrapper the other two apps use. No footer: the terms and
            privacy links belong on the consumer products, and this host has neither document
            because it is not a consumer product. */}
        <div className="site">
          <AdminRoutes />
        </div>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
