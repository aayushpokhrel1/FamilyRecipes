import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { listMyFamilies } from "../lib/api/families";
import type { Family } from "../lib/api/types";

type FamilyState = {
  families: Family[];
  activeFamily: Family | null;
  setActiveFamily: (family: Family) => void;
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

function pickActive(families: Family[]): Family | null {
  const storedId = readStoredId();
  const stored = storedId ? families.find((f) => f.id === storedId) : undefined;
  return stored ?? families[0] ?? null;
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const [families, setFamilies] = useState<Family[]>([]);
  const [activeFamily, setActive] = useState<Family | null>(null);

  async function reload() {
    const list = await listMyFamilies();
    setFamilies(list);
    setActive(pickActive(list));
  }

  function setActiveFamily(family: Family) {
    setActive(family);
    writeStoredId(family.id);
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <Ctx.Provider value={{ families, activeFamily, setActiveFamily, reload }}>
      {children}
    </Ctx.Provider>
  );
}
