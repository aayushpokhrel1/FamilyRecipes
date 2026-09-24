import { Fragment, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { addDays, dayLabel } from "../lib/dates";
import {
  listPlans, listItems, addRecipe, addLeftover, removeItem, moveItem, setViewMode,
  setItemServings, setPlanDates, duplicatePlan,
} from "../lib/api/mealPlans";
import { listRecipes } from "../lib/api/recipes";
import { suggestedServings } from "../lib/leftovers";
import type { MealPlan, MealPlanItem, MealSlot, Recipe } from "../lib/api/types";
import GroceryPanel from "../components/GroceryPanel";

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner"];
const LENGTHS = [3, 5, 7, 14];

export default function MealPlanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activeFamily } = useFamily();
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [items, setItems] = useState<MealPlanItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [pick, setPick] = useState("");
  const [cell, setCell] = useState<{ day: string; slot: MealSlot } | null>(null);
  const [nudge, setNudge] = useState<{ itemId: string; title: string; current: number; suggested: number } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) return;
    listPlans().then((all) => setPlan(all.find((p) => p.id === id) ?? null));
    listItems(id).then(setItems);
  }, [id, reloadKey]);
  useEffect(() => {
    if (activeFamily) listRecipes(activeFamily.id).then(setRecipes).catch(() => setRecipes([]));
  }, [activeFamily]);
  // A link from My Kitchen arrives pre-aimed at a day and slot. Read once on
  // mount only, so a later Cancel is not undone by a re-render.
  useEffect(() => {
    const day = searchParams.get("day");
    const slot = searchParams.get("slot");
    if (day && SLOTS.includes(slot as MealSlot)) setCell({ day, slot: slot as MealSlot });
  }, []);

  const titleById = new Map(recipes.map((r) => [r.id, r.title]));
  const recipeById = new Map(recipes.map((r) => [r.id, r]));
  function refresh() { setReloadKey((k) => k + 1); }

  async function handleAdd() {
    if (!id || !pick) return;
    if (cell) await addRecipe(id, pick, { day: cell.day, mealSlot: cell.slot });
    else await addRecipe(id, pick);
    setPick("");
    setCell(null);
    refresh();
  }
  async function handleToggleView() {
    if (!plan) return;
    await setViewMode(plan.id, plan.view_mode === "list" ? "calendar" : "list");
    refresh();
  }
  async function handleStartDate(value: string) {
    if (!plan) return;
    await setPlanDates(plan.id, value || null, plan.length_days);
    refresh();
  }
  async function handleLength(value: string) {
    if (!plan) return;
    await setPlanDates(plan.id, plan.start_date, Number(value));
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
  async function handleServings(it: MealPlanItem, value: number) {
    await setItemServings(it.id, value);
    refresh();
  }

  // A leftover is the same pot eaten again, so it lands on the next day's lunch.
  // The servings bump is only ever a suggestion: nothing is written until the
  // user presses Bump.
  async function handleLeftover(it: MealPlanItem) {
    if (!plan || !it.day) return;
    const day = addDays(it.day, 1);
    await addLeftover(plan.id, it.id, { day, mealSlot: "lunch" });
    const n = items.filter((x) => x.leftover_of === it.id).length + 1;
    const base = it.servings ?? recipeById.get(it.recipe_id)?.servings ?? null;
    const suggested = suggestedServings(base, n);
    const current = it.servings ?? base ?? 0;
    if (suggested !== null && current < suggested) {
      setNudge({
        itemId: it.id,
        title: titleById.get(it.recipe_id) ?? it.recipe_id,
        current,
        suggested,
      });
    }
    refresh();
  }
  async function handleBump() {
    if (!nudge) return;
    await setItemServings(nudge.itemId, nudge.suggested);
    setNudge(null);
    refresh();
  }

  function servingsStepper(it: MealPlanItem) {
    const recipe = recipeById.get(it.recipe_id);
    const base = recipe?.servings ?? null;
    const canScale = base !== null && base > 0;
    const value = it.servings ?? base ?? 1;
    return (
      <div className="portions">
        <span>Serves</span>
        <button
          type="button"
          aria-label="decrease"
          disabled={!canScale || value <= 1}
          title={canScale ? undefined : "This recipe does not record how many it serves, so it cannot be scaled."}
          onClick={() => handleServings(it, Math.max(1, value - 1))}
        >
          -
        </button>
        <span aria-label="portions value">{value}</span>
        <button
          type="button"
          aria-label="increase"
          disabled={!canScale}
          title={canScale ? undefined : "This recipe does not record how many it serves, so it cannot be scaled."}
          onClick={() => handleServings(it, value + 1)}
        >
          +
        </button>
      </div>
    );
  }

  function itemRow(it: MealPlanItem) {
    return (
      <li key={it.id} className="plate plate-row meal-item">
        <span className="row-title">{titleById.get(it.recipe_id) ?? it.recipe_id}</span>
        {servingsStepper(it)}
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

  const days = plan.start_date
    ? Array.from({ length: plan.length_days }, (_, i) => addDays(plan.start_date!, i))
    : [];

  const cellItems = (day: string, slot: MealSlot) =>
    items.filter((it) => it.day === day && it.meal_slot === slot);

  function weekCell(day: string, slot: MealSlot) {
    const cellItemList = cellItems(day, slot);
    if (cellItemList.length === 0) {
      return (
        <button
          key={`${day}-${slot}`}
          type="button"
          className="week-cell empty"
          aria-label={`Add to ${slot} on ${dayLabel(day)}`}
          onClick={() => setCell({ day, slot })}
        >
          +
        </button>
      );
    }
    return (
      <div key={`${day}-${slot}`} className="week-cell">
        {cellItemList.map((it) => (
          <div key={it.id}>
            <span>{titleById.get(it.recipe_id) ?? it.recipe_id}</span>
            {it.leftover_of !== null ? (
              <span className="leftover">leftovers</span>
            ) : (
              <>
                {servingsStepper(it)}
                <button type="button" onClick={() => handleLeftover(it)}>Leftovers</button>
              </>
            )}
            <button type="button" onClick={async () => { await removeItem(it.id); refresh(); }}>Remove</button>
          </div>
        ))}
      </div>
    );
  }

  const showGrid = plan.view_mode === "calendar" && days.length > 0;

  return (
    <div>
      <h1>{plan.name}</h1>
      <div className="recipe-actions">
        <button type="button" onClick={handleToggleView}>
          {plan.view_mode === "list" ? "Calendar view" : "List view"}
        </button>
        <div className="plan-dates">
          <label>
            Starts
            <input
              type="date"
              value={plan.start_date ?? ""}
              onChange={(e) => handleStartDate(e.target.value)}
            />
          </label>
          <label>
            Days
            <select value={plan.length_days ?? 7} onChange={(e) => handleLength(e.target.value)}>
              {LENGTHS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button type="button" disabled={!plan.start_date} onClick={async () => {
            if (!plan.start_date) return;
            const newId = await duplicatePlan(plan.id, addDays(plan.start_date, plan.length_days));
            navigate(`/kitchen/${newId}`);
          }}>Duplicate to next week</button>
        </div>
      </div>

      {nudge && (
        <p className="nudge" role="status">
          {nudge.title} is set to {nudge.current} servings. Bump to {nudge.suggested} to cover the leftovers?
          <button type="button" onClick={handleBump}>Bump</button>
          <button type="button" onClick={() => setNudge(null)}>No</button>
        </p>
      )}

      {showGrid ? (
        <div
          className="week-grid"
          style={{ gridTemplateColumns: `auto repeat(${days.length}, minmax(120px, 1fr))` }}
        >
          <span className="slot-head" />
          {days.map((day) => (
            <span key={day} className="col-head">{dayLabel(day)}</span>
          ))}
          {SLOTS.map((slot) => (
            <Fragment key={slot}>
              <span className="slot-head">{slot}</span>
              {days.map((day) => weekCell(day, slot))}
            </Fragment>
          ))}
        </div>
      ) : plan.view_mode === "list" ? (
        <ul className="stack">
          {items.map((it) => itemRow(it))}
          {items.length === 0 && <li className="vault-note">No recipes picked yet.</li>}
        </ul>
      ) : (
        <div>
          <p className="vault-note">Set a start date to see this plan as a week.</p>
          <ul className="stack">
            {items.map((it) => itemRow(it))}
            {items.length === 0 && <li className="vault-note">No recipes picked yet.</li>}
          </ul>
        </div>
      )}

      <div className="vault-tools">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">
            {cell ? `Add to ${cell.slot} on ${dayLabel(cell.day)}...` : "Add a recipe from the vault..."}
          </option>
          {recipes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
        <button type="button" className="action" onClick={handleAdd} disabled={!pick}>Add recipe</button>
        {cell && (
          <button type="button" onClick={() => setCell(null)}>
            Cancel {dayLabel(cell.day)} {cell.slot}
          </button>
        )}
      </div>

      <GroceryPanel key={reloadKey} planId={plan.id} />
    </div>
  );
}
