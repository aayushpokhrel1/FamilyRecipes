import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getSession, onAuthChange } from "../lib/api/auth";

type AuthState = { userId: string | null; loading: boolean };
const Ctx = createContext<AuthState>({ userId: null, loading: true });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ userId: null, loading: true });
  useEffect(() => {
    getSession().then((s) => setState({ userId: s?.user.id ?? null, loading: false }));
    const { data } = onAuthChange((uid) => setState({ userId: uid, loading: false }));
    return () => data.subscription.unsubscribe();
  }, []);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
