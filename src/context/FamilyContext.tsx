import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ensureOwnKitchen, listMyFamilies } from "../lib/api/families";
import { useAuth } from "./AuthContext";
import { reportError } from "../lib/api/errorLog";
import type { MyFamily } from "../lib/api/types";

type FamilyState = {
  families: MyFamily[];
  activeFamily: MyFamily | null;
  setActiveFamily: (family: MyFamily) => void;
  reload: () => Promise<void>;
};

const Ctx = createContext<FamilyState>({
  families: [],
  activeFamily: null,
  setActiveFamily: () => {},
  reload: async () => {},
});
export const useFamily = () => useContext(Ctx);

function readStoredId(): string | null {
  try {
    return localStorage.getItem("activeFamilyId");
  } catch {
    return null;
  }
}

function writeStoredId(id: string) {
  try {
    localStorage.setItem("activeFamilyId", id);
  } catch {
    // ignore storage failures
  }
}

function pickActive(families: MyFamily[]): MyFamily | null {
  const storedId = readStoredId();
  const stored = storedId ? families.find((f) => f.id === storedId) : undefined;
  return stored ?? families[0] ?? null;
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [families, setFamilies] = useState<MyFamily[]>([]);
  const [activeFamily, setActive] = useState<MyFamily | null>(null);

  async function reload() {
    // Signed out means no families and nothing to ask for. Without this the provider would
    // call ensure_own_kitchen with no session on every visit by a stranger, earning a 42501
    // it would then log, which is noise in the error table rather than a signal.
    if (!userId) {
      setFamilies([]);
      setActive(null);
      return;
    }
    let list = await listMyFamilies();
    // Only when the list is EMPTY. A cook who already has a kitchen must cost zero extra
    // round trips on every page load, so the RPC is never called on the happy path.
    if (list.length === 0) {
      try {
        await ensureOwnKitchen();
        // The second listing is what wins. The row the database has carries the name and
        // invite code, and fabricating a family object from the returned id would be a
        // second source of truth that drifts from the real one.
        list = await listMyFamilies();
      } catch (err) {
        // Never retry in a loop, and never let a failure here blank the app. The pages
        // already handle "no family" by showing a message, and an exception thrown out of
        // the provider takes the whole app down, so this falls through with the empty list.
        reportError("load:family-context", err);
      }
    }
    setFamilies(list);
    setActive(pickActive(list));
  }

  function setActiveFamily(family: MyFamily) {
    setActive(family);
    writeStoredId(family.id);
  }

  // Keyed on userId, NOT [] . On [] this ran exactly once, while the session was still being
  // restored, so a cook who had just signed in got the signed-out answer: a brand-new account
  // accepted the terms and was still told to "create or join a family" until they happened to
  // reload. A browser found that in a minute; the unit tests could not see it, because they
  // render the provider with the session already settled.
  //
  // It also fixes signing out and back in as someone else inside one session, which used to
  // leave the first cook's families on screen.
  useEffect(() => {
    reload();
  }, [userId]);

  return (
    <Ctx.Provider value={{ families, activeFamily, setActiveFamily, reload }}>
      {children}
    </Ctx.Provider>
  );
}
