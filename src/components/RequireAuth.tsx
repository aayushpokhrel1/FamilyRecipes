import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Skeleton from "./Skeleton";
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Skeleton shape="plate" count={3} />;
  // Without this state, every guarded link sent to a signed-out person loses its destination,
  // and an invite link is exactly that case.
  if (!userId) return <Navigate to="/signin" replace state={{ from: location }} />;
  return <>{children}</>;
}
