import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listPlans, createPlan, deletePlan, setShared, listUpcoming, setPlanDates, setViewMode,
} from "../lib/api/mealPlans";
import { addDays, dayLabel, today } from "../lib/dates";
import type { MealPlan, MealSlot, UpcomingItem } from "../lib/api/types";

const SLOTS = ["breakfast", "lunch", "dinner"] as const;
// How far ahead the kitchen looks. One constant: listUpcoming's window and the
// rendered day list are the same window, and drifting apart drops items.
const DAYS = 4;

export default function MyKitchen() {
  const { activeFamily } = useFamily();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try { setPlans(await listPlans()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { listUpcoming(DAYS).then(setUpcoming).catch(() => setUpcoming([])); }, []);

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
  async function handleStartWeek() {
    if (!activeFamily) return;
    const plan = await createPlan(activeFamily.id, "This week");
    await setPlanDates(plan.id, today(), 7);
    await setViewMode(plan.id, "calendar");
    navigate(`/kitchen/${plan.id}`);
  }

  // The four days the kitchen always shows, whether or not anything is planned.
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today(), i));

  // listPlans returns newest-created first, so .find prefers the most recently
  // made plan when two overlap.
  function coveringPlan(day: string): MealPlan | undefined {
    return plans.find((p) => p.start_date !== null
      && p.start_date <= day && day < addDays(p.start_date, p.length_days));
  }

  function dayHeading(day: string): string {
    if (day === today()) return "Today";
    if (day === addDays(today(), 1)) return "Tomorrow";
    return dayLabel(day);
  }

  function itemsFor(day: string, slot: MealSlot | null): UpcomingItem[] {
    return upcoming.filter((u) => u.day === day && u.meal_slot === slot);
  }

  function itemRow(item: UpcomingItem) {
    return (
      <li key={item.id} className="plate plate-row">
        <span className="slot">{item.meal_slot ?? "any"}</span>
        <Link to={`/recipes/${item.recipe.id}`}>{item.recipe.title}</Link>
        {item.servings !== null && <span>{item.servings} servings</span>}
        <span className="chip">{item.plan.name}</span>
        {item.readOnly && <span className="chip">shared</span>}
        {item.isLeftover && <span className="chip">leftovers</span>}
        <Link to={`/recipes/${item.recipe.id}/cook`}>Cook</Link>
      </li>
    );
  }

  return (
    <div>
      <h1>My Kitchen</h1>
      {!activeFamily && (
        <p>Create or join a family first. <Link to="/families">Families</Link></p>
      )}
      <section className="upnext">
        {!loading && days.every((d) => !coveringPlan(d)) && (
          <button type="button" className="action" disabled={!activeFamily} onClick={handleStartWeek}>
            Start this week
          </button>
        )}
        {days.map((day) => {
          const plan = coveringPlan(day);
          return (
            <div key={day}>
              <h3>{dayHeading(day)}</h3>
              <ul className="stack">
                {SLOTS.map((slot) => {
                  const items = itemsFor(day, slot);
                  if (items.length > 0) return items.map((item) => itemRow(item));
                  return (
                    <li key={`${day}-${slot}`} className="plate plate-row empty-slot">
                      <span className="slot">{slot}</span>
                      {plan ? (
                        <Link to={`/kitchen/${plan.id}?day=${day}&slot=${slot}`}
                              aria-label={`Add ${slot} on ${dayLabel(day)}`}>+</Link>
                      ) : null}
                    </li>
                  );
                })}
                {itemsFor(day, null).map((item) => itemRow(item))}
              </ul>
            </div>
          );
        })}
      </section>
      <details className="plans">
        <summary>Plans</summary>
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
      </details>
    </div>
  );
}
