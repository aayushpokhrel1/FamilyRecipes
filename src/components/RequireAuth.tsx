import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { withNext } from "../lib/nextPath";
import Skeleton from "./Skeleton";
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Skeleton shape="plate" count={3} />;
  // In the URL, not in router state. State is in memory and dies the moment the browser
  // leaves the page, which Google and an email confirmation link both do. See lib/nextPath.ts.
  if (!userId) {
    return <Navigate to={withNext("/signin", location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}
