import { type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { userId, loading } = useAuth();
  if (loading) return <p>Loading...</p>;
  if (!userId) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}
