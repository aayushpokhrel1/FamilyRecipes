import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listPantry, addItem, setState as setItemState, removeItem,
  type PantryItem, type PantryState,
} from "../lib/api/pantry";
import { categoryFor, CATEGORY_ORDER, CATALOG_ITEMS } from "../lib/catalog";

// Tap to cycle. Three states in a ring is the cheapest upkeep gesture there
// is, and upkeep is the whole risk with a cupboard.
const NEXT: Record<PantryState, PantryState> = { have: "low", low: "out", out: "have" };

export default function Cupboard() {
  const { activeFamily } = useFamily();
  const [items, setItems] = useState<PantryItem[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeFamily) { setLoading(false); return; }
    listPantry(activeFamily.id)
      .then(setItems)
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

      {!loading && items.length === 0 && (
        <p className="vault-note">Nothing in the cupboard yet.</p>
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
