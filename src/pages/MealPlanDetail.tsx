import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, listItems, addRecipe, removeItem, moveItem, setViewMode } from "../lib/api/mealPlans";
import { listRecipes } from "../lib/api/recipes";
import type { MealPlan, MealPlanItem, MealSlot, Recipe } from "../lib/api/types";
import GroceryPanel from "../components/GroceryPanel";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];

export default function MealPlanDetail() {
  const { id } = useParams();
  const { activeFamily } = useFamily();
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pick, setPick] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    listPlans().then((all) => setPlan(all.find((p) => p.id === id) ?? null));
    listItems(id).then(setItems);
  }, [id, reloadKey]);
  useEffect(() => {
    if (activeFamily) listRecipes(activeFamily.id).then(setRecipes).catch(() => setRecipes([]));
  }, [activeFamily]);

  const titleById = new Map(recipes.map((r) => [r.id, r.title]));
  function refresh() { setReloadKey((k) => k + 1); }

  async function handleAdd() {
    if (!id || !pick) return;
    await addRecipe(id, pick);
    setPick("");
    refresh();
  }
  async function handleToggleView() {
    if (!plan) return;
    await setViewMode(plan.id, plan.view_mode === "list" ? "calendar" : "list");
    refresh();
  }
  async function handleDay(it: MealPlanItem, value: string) {
    await moveItem(it.id, { day: value || null });
    refresh();
  }
  async function handleSlot(it: MealPlanItem, value: string) {
    await moveItem(it.id, { mealSlot: (value || null) as MealSlot | null });
    refresh();
  }

  function itemRow(it: MealPlanItem) {
    return (
      <li key={it.id} className="plate plate-row meal-item">
        <span className="row-title">{titleById.get(it.recipe_id) ?? it.recipe_id}</span>
        <span className="day-slot">
          <input type="date" aria-label="day" value={it.day ?? ""} onChange={(e) => handleDay(it, e.target.value)} />
          <select aria-label="meal slot" value={it.meal_slot ?? ""} onChange={(e) => handleSlot(it, e.target.value)}>
            <option value="">Unscheduled</option>
            {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </span>
        <button type="button" onClick={async () => { await removeItem(it.id); refresh(); }}>Remove</button>
      </li>
    );
  }

  if (!plan) return <p>Loading...</p>;

  // calendar groups items by day (distinct dates ascending, undated bucket last)
  const days = Array.from(new Set(items.map((it) => it.day)))
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : a > b ? 1 : 0));

  return (
    <div>
      <h1>{plan.name}</h1>
      <div className="recipe-actions">
        <button type="button" onClick={handleToggleView}>
          {plan.view_mode === "list" ? "Calendar view" : "List view"}
        </button>
      </div>

      {plan.view_mode === "list" ? (
        <ul className="stack">
          {items.map((it) => itemRow(it))}
          {items.length === 0 && <li className="vault-note">No recipes picked yet.</li>}
        </ul>
      ) : (
        <div>
          {days.map((day) => (
            <section key={day ?? "undated"} className="plate cal-day">
              <h3>{day ?? "No date"}</h3>
              {SLOTS.map((slot) => {
                const slotItems = items.filter((it) => it.day === day && it.meal_slot === slot);
                if (slotItems.length === 0) return null;
                return (
                  <div key={slot}>
                    <h4>{slot}</h4>
                    <ul className="stack">{slotItems.map((it) => itemRow(it))}</ul>
                  </div>
                );
              })}
              {items.filter((it) => it.day === day && !it.meal_slot).length > 0 && (
                <div>
                  <h4>Any time</h4>
                  <ul className="stack">{items.filter((it) => it.day === day && !it.meal_slot).map((it) => itemRow(it))}</ul>
                </div>
              )}
            </section>
          ))}
          {items.length === 0 && <p className="vault-note">No recipes picked yet.</p>}
        </div>
      )}

      <div className="vault-tools">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a recipe from the vault...</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <button type="button" className="action" onClick={handleAdd} disabled={!pick}>Add recipe</button>
      </div>

      <GroceryPanel planId={plan.id} />
    </div>
  );
}
