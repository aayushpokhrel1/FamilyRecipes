import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import Skeleton from "./Skeleton";
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth();
  if (loading) return <Skeleton shape="plate" count={3} />;
  if (!userId) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
