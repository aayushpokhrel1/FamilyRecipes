import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listPantry, addItem, setState as setItemState, removeItem,
  type PantryItem, type PantryState,
} from "../lib/api/pantry";
import { categoryFor, CATEGORY_ORDER, CATALOG_ITEMS } from "../lib/catalog";
import { listRecipeIngredientIndex } from "../lib/api/recipes";
import { seedSuggestions } from "../lib/seedSuggestions";

// Tap to cycle. Three states in a ring is the cheapest upkeep gesture there
// is, and upkeep is the whole risk with a cupboard.
const NEXT: Record<PantryState, PantryState> = { have: "low", low: "out", out: "have" };

export default function Cupboard() {
  const { activeFamily } = useFamily();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeFamily) { setLoading(false); return; }
    listPantry(activeFamily.id)
      .then(async (list) => {
        setItems(list);
        if (list.length === 0) {
          const index = await listRecipeIngredientIndex(activeFamily.id);
          setSeeds(seedSuggestions(index));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activeFamily]);

  async function handleCycle(item: PantryItem) {
    const next = NEXT[item.state];
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, state: next } : i)));
    try { await setItemState(item.id, next); } catch (e: any) { setError(e.message); }
  }

  async function handleAdd() {
    if (!activeFamily || !label.trim()) return;
    try {
      const added = await addItem(activeFamily.id, label, "keep");
      setItems((list) => [...list.filter((i) => i.id !== added.id), added]
        .sort((a, b) => a.label.localeCompare(b.label)));
      setLabel("");
    } catch (e: any) { setError(e.message); }
  }

  async function handleRemove(id: string) {
    setItems((list) => list.filter((i) => i.id !== id));
    try { await removeItem(id); } catch (e: any) { setError(e.message); }
  }

  async function handleSeed() {
    if (!activeFamily) return;
    try {
      const added = await Promise.all(
        [...picked].map((l) => addItem(activeFamily.id, l, "keep")));
      setItems(added.sort((a, b) => a.label.localeCompare(b.label)));
      setSeeds([]);
      setPicked(new Set());
    } catch (e: any) { setError(e.message); }
  }

  // The aisle is a fact about the ingredient, so it is derived on render and
  // never stored. Same rule the grocery list already follows.
  const groups = new Map<string, PantryItem[]>();
  for (const item of items) {
    const cat = categoryFor(item.label) ?? "Other";
    groups.set(cat, [...(groups.get(cat) ?? []), item]);
  }
  const order = [...CATEGORY_ORDER, "Other"].filter((c) => groups.has(c));

  return (
    <div className="cupboard">
      <h1>The cupboard</h1>
      <p className="vault-note">
        Tap anything to say whether you have it, are running low, or have run out.
        Low and out land on this week's shopping.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && <p className="vault-note">Loading...</p>}

      {!loading && items.length === 0 && seeds.length > 0 && (
        <section className="panel">
          <h2>Start with what you usually keep</h2>
          <p className="vault-note">
            Taken from the ingredients your own recipes use most. Tick the ones you keep in.
          </p>
          <ul className="chip-row cupboard-items">
            {seeds.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className={`chip cupboard-chip ${picked.has(s) ? "is-have" : ""}`}
                  aria-pressed={picked.has(s)}
                  onClick={() => setPicked((p) => {
                    const next = new Set(p);
                    if (next.has(s)) next.delete(s); else next.add(s);
                    return next;
                  })}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="action" disabled={picked.size === 0} onClick={handleSeed}>
            Add {picked.size} to the cupboard
          </button>
        </section>
      )}

      {!loading && items.length === 0 && seeds.length === 0 && (
        <p className="vault-note">
          Nothing in the cupboard yet, and no recipes to suggest from. Add something below.
        </p>
      )}

      {order.map((cat) => (
        <section key={cat} className="panel">
          <h2>{cat}</h2>
          <ul className="chip-row cupboard-items">
            {groups.get(cat)!.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`chip cupboard-chip is-${item.state}`}
                  onClick={() => handleCycle(item)}
                  aria-label={`${item.label}, ${item.state}`}
                >
                  {item.label}
                  {item.kind === "week" && <span className="cupboard-week"> this week</span>}
                </button>
                <button
                  type="button"
                  className="cupboard-remove"
                  aria-label={`Remove ${item.label}`}
                  onClick={() => handleRemove(item.id)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="panel">
        <label htmlFor="cupboard-add">Add to the cupboard</label>
        <input
          id="cupboard-add"
          list="cupboard-catalog"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Rice, olive oil..."
        />
        <datalist id="cupboard-catalog">
          {CATALOG_ITEMS.map((i) => <option key={i} value={i} />)}
        </datalist>
        <button type="button" className="action" onClick={handleAdd} disabled={!activeFamily}>
          Add
        </button>
      </section>

      <p className="vault-note"><Link to="/kitchen">Back to My Kitchen</Link></p>
    </div>
  );
}
