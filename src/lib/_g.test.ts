import { expect, it } from "vitest";
const a = import.meta.glob("../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string,string>;
const e = Object.entries(a).sort(([x],[y]) => x.localeCompare(y));
it("x", () => {
  const re = new RegExp(`create\s+(?:or\s+replace\s+)?view\s+public_cooks\s+as\b([\s\S]*?);`, "i");
  expect([e.length, e.filter(([,t]) => re.test(t)).map(([k])=>k), /create view public_cooks/.test(e.map(([,t])=>t).join(""))]).toEqual([]);
});
