import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, listItems, addRecipe, removeItem, setViewMode } from "../lib/api/mealPlans";
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

  if (!plan) return <p>Loading...</p>;

  return (
    <div>
      <h1>{plan.name}</h1>
      <button type="button" onClick={handleToggleView}>
        {plan.view_mode === "list" ? "Calendar view" : "List view"}
      </button>

      {plan.view_mode === "list" ? (
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              {titleById.get(it.recipe_id) ?? it.recipe_id}
              <button type="button" onClick={async () => { await removeItem(it.id); refresh(); }}>Remove</button>
            </li>
          ))}
          {items.length === 0 && <li>No recipes picked yet.</li>}
        </ul>
      ) : (
        <div>
          {SLOTS.map((slot) => (
            <section key={slot}>
              <h3>{slot}</h3>
              <ul>
                {items.filter((it) => it.meal_slot === slot).map((it) => (
                  <li key={it.id}>{titleById.get(it.recipe_id) ?? it.recipe_id}</li>
                ))}
              </ul>
            </section>
          ))}
          <section>
            <h3>Unscheduled</h3>
            <ul>
              {items.filter((it) => !it.meal_slot).map((it) => (
                <li key={it.id}>{titleById.get(it.recipe_id) ?? it.recipe_id}</li>
              ))}
            </ul>
          </section>
        </div>
      )}

      <div>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a recipe from the vault...</option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <button type="button" onClick={handleAdd} disabled={!pick}>Add recipe</button>
      </div>

      <GroceryPanel planId={plan.id} />
    </div>
  );
}
