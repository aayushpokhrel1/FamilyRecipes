import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, createPlan, deletePlan, setShared, listUpcoming } from "../lib/api/mealPlans";
import { addDays, dayLabel, today } from "../lib/dates";
import type { MealPlan, UpcomingItem } from "../lib/api/types";

export default function MyKitchen() {
  const { activeFamily } = useFamily();
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPlans(await listPlans()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { listUpcoming(4).then(setUpcoming).catch(() => setUpcoming([])); }, []);

  async function handleCreate() {
    if (!activeFamily || !name.trim()) return;
    await createPlan(activeFamily.id, name.trim());
    setName("");
    reload();
  }
  async function handleDelete(id: string) {
    await deletePlan(id);
    reload();
  }
  async function handleShare(p: MealPlan) {
    await setShared(p.id, !p.is_shared);
    reload();
  }

  // listUpcoming already sorts by day then slot, so grouping in order keeps the
  // days in order too.
  const byDay = new Map<string, UpcomingItem[]>();
  for (const u of upcoming) byDay.set(u.day, [...(byDay.get(u.day) ?? []), u]);

  function dayHeading(day: string): string {
    if (day === today()) return "Today";
    if (day === addDays(today(), 1)) return "Tomorrow";
    return dayLabel(day);
  }

  return (
    <div>
      <h1>My Kitchen</h1>
      {!activeFamily && (
        <p>Create or join a family first. <Link to="/families">Families</Link></p>
      )}
      <section className="upnext">
        {upcoming.length === 0 ? (
          <p className="vault-note">Nothing planned yet.</p>
        ) : (
          Array.from(byDay.entries()).map(([day, items]) => (
            <div key={day}>
              <h3>{dayHeading(day)}</h3>
              <ul className="stack">
                {items.map((item) => (
                  <li key={item.id} className="plate plate-row">
                    <span className="slot">{item.meal_slot ?? "any"}</span>
                    <Link to={`/recipes/${item.recipe.id}`}>{item.recipe.title}</Link>
                    {item.servings !== null && <span>{item.servings} servings</span>}
                    <span className="chip">{item.plan.name}</span>
                    {item.readOnly && <span className="chip">shared</span>}
                    {item.isLeftover && <span className="chip">leftovers</span>}
                    <Link to={`/recipes/${item.recipe.id}/cook`}>Cook</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
      <div className="vault-tools">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" />
        <button type="button" className="action" onClick={handleCreate} disabled={!activeFamily}>New plan</button>
      </div>
      {loading && <p className="vault-note">Loading...</p>}
      {!loading && plans.length === 0 && <p className="vault-note">No plans yet.</p>}
      <ul className="stack">
        {plans.map((p) => (
          <li key={p.id} className="plate plate-row">
            <Link to={`/kitchen/${p.id}`}>{p.name}</Link>
            {p.is_shared && <span className="chip">shared</span>}
            <button type="button" onClick={() => handleShare(p)}>
              {p.is_shared ? "Make private" : "Share with family"}
            </button>
            <button type="button" onClick={() => handleDelete(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
