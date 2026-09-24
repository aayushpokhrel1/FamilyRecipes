import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listPlans, createPlan, deletePlan, setShared, listUpcoming, setPlanDates, setViewMode,
  duplicatePlan,
} from "../lib/api/mealPlans";
import { getCoverPhotoUrl } from "../lib/api/photos";
import { listPantry, type PantryItem } from "../lib/api/pantry";
import { notCookedLately } from "../lib/api/cookLog";
import { addDays, dayLabel, today } from "../lib/dates";
import UpcomingGroceryPanel from "../components/UpcomingGroceryPanel";
import type { MealPlan, MealSlot, NotCookedLately, UpcomingItem } from "../lib/api/types";

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
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [staples, setStaples] = useState<PantryItem[]>([]);
  const [forgotten, setForgotten] = useState<NotCookedLately[]>([]);

  async function reload() {
    setLoading(true);
    try { setPlans(await listPlans()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);
  useEffect(() => { listUpcoming(DAYS).then(setUpcoming).catch(() => setUpcoming([])); }, []);
  useEffect(() => {
    if (!activeFamily) { setStaples([]); return; }
    listPantry(activeFamily.id).then(setStaples).catch(() => setStaples([]));
  }, [activeFamily?.id]);
  // Three is a nudge, not a second recipe index. A failed suggestion must never
  // break the page, so the catch empties the list rather than surfacing.
  useEffect(() => {
    if (!activeFamily) { setForgotten([]); return; }
    notCookedLately(activeFamily.id, 3).then(setForgotten).catch(() => setForgotten([]));
  }, [activeFamily?.id]);

  // Keyed on the recipe, and cleared when there is no hero, so a photo can
  // never survive into a different recipe.
  const heroRecipeId = upcoming[0]?.recipe.id;
  useEffect(() => {
    if (!heroRecipeId) { setCoverUrl(null); return; }
    getCoverPhotoUrl(heroRecipeId).then(setCoverUrl).catch(() => setCoverUrl(null));
  }, [heroRecipeId]);

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
  // Duplicating onto TODAY is the point: it refills the empty week on screen.
  async function handleRepeatLastWeek(planId: string) {
    const newId = await duplicatePlan(planId, today());
    navigate(`/kitchen/${newId}`);
  }

  // The four days the kitchen always shows, whether or not anything is planned.
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today(), i));

  // listPlans returns newest-created first, so .find prefers the most recently
  // made plan when two overlap.
  function coveringPlan(day: string): MealPlan | undefined {
    return plans.find((p) => p.start_date !== null
      && p.start_date <= day && day < addDays(p.start_date, p.length_days));
  }

  // The most recent dated plan whose window has already ended: the week to
  // repeat. plans is newest first, so .find gives the right one.
  const lastWeek = plans.find((p) => p.start_date !== null
    && addDays(p.start_date, p.length_days) <= today());

  function dayHeading(day: string): string {
    if (day === today()) return "Today";
    if (day === addDays(today(), 1)) return "Tomorrow";
    return dayLabel(day);
  }

  // A timestamptz is a real instant, so toLocaleDateString is right here; this
  // is not the plain YYYY-MM-DD plan-date case src/lib/dates.ts protects.
  function whenLabel(lastCooked: string | null): string {
    if (lastCooked === null) return "never cooked";
    return "last made " + new Date(lastCooked).toLocaleDateString(undefined, {
      month: "long", year: "numeric",
    });
  }

  // upcoming is already sorted by day then slot, so the first one is next up.
  const hero = upcoming[0];
  const heroWhen = hero
    ? (hero.meal_slot ? `${dayHeading(hero.day)} · ${hero.meal_slot}` : dayHeading(hero.day))
    : "";

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
      {/* The hero is a spotlight, not a separate item: the same meal still
          appears in its day block below. */}
      {hero && (
        <section className="plate hero">
          {coverUrl && <img className="hero-photo" src={coverUrl} alt="" />}
          <div className="hero-body">
            <span className="stamp">{heroWhen}</span>
            <h2>{hero.recipe.title}</h2>
            <p className="hero-meta">
              {[hero.servings !== null ? `${hero.servings} servings` : null, hero.plan.name]
                .filter(Boolean).join(" · ")}
            </p>
            <div className="hero-actions">
              <Link className="action" to={`/recipes/${hero.recipe.id}/cook`}>Cook this</Link>
              <Link to={`/recipes/${hero.recipe.id}`}>View recipe</Link>
            </div>
          </div>
        </section>
      )}
      <section className="upnext">
        {!loading && days.every((d) => !coveringPlan(d)) && (
          <>
            <button type="button" className="action" disabled={!activeFamily} onClick={handleStartWeek}>
              Start this week
            </button>
            {lastWeek && (
              <button type="button" onClick={() => handleRepeatLastWeek(lastWeek.id)}>
                Repeat last week
              </button>
            )}
          </>
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
      {/* Not a plate: the day rows above are individual plates, and a
          full-width one here would fight them. On-wall text colours are
          therefore correct inside it. */}
      {activeFamily && (
        <section className="panel">
          <h2>This week's shopping</h2>
          <UpcomingGroceryPanel days={DAYS} />
        </section>
      )}
      {/* Read-only on purpose: full management lives in Settings, and a second
          editor here would be two places to change the same thing. */}
      {activeFamily && staples.length > 0 && (
        <section className="staples-strip">
          <h3>Always in</h3>
          <div className="chip-row">{staples.map((s) => <span className="chip" key={s.id}>{s.label}</span>)}</div>
          <p className="vault-note"><Link to="/settings">Manage staples</Link></p>
        </section>
      )}
      {/* A family that cooks everything regularly sees nothing here, not an
          empty heading. */}
      {activeFamily && forgotten.length > 0 && (
        <section className="forgotten">
          <h3>Not made in a while</h3>
          <ul className="stack">
            {forgotten.map((f) => (
              <li key={f.recipe.id} className="plate plate-row">
                <Link to={`/recipes/${f.recipe.id}`}>{f.recipe.title}</Link>
                <span className="stamp">{whenLabel(f.lastCooked)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
