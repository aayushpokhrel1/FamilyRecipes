import { useEffect, useState } from "react";
import { getGroceryList, toggleChecked, addManualItem, removeManualItem } from "../lib/api/mealPlans";
import { listPantry, addItem, removeItem, type PantryItem } from "../lib/api/pantry";
import { setCategoryOverride } from "../lib/api/ingredientCategories";
import { useFamily } from "../context/FamilyContext";
import type { GroceryLine } from "../lib/api/types";
import { CATEGORY_ORDER } from "../lib/catalog";

function contribLabel(c: { quantity: string | null; unit: string | null; recipeTitle: string }): string {
  const qty = [c.quantity, c.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} (${c.recipeTitle})` : `(${c.recipeTitle})`;
}

function totalLabel(t: { quantity: string; unit: string }): string {
  return [t.quantity, t.unit].filter(Boolean).join(" ").trim();
}

export default function GroceryPanel({ planId }: { planId: string }) {
  const { activeFamily } = useFamily();
  const [lines, setLines] = useState<GroceryLine[]>([]);
  const [label, setLabel] = useState("");
  const [staples, setStaples] = useState<PantryItem[]>([]);
  const [stapleLabel, setStapleLabel] = useState("");

  async function reload() { setLines(await getGroceryList(planId)); }
  useEffect(() => { reload(); }, [planId]);

  async function reloadStaples() {
    if (!activeFamily) { setStaples([]); return; }
    setStaples(await listPantry(activeFamily.id));
  }
  useEffect(() => { reloadStaples(); }, [activeFamily?.id]);

  async function handleToggle(line: GroceryLine) {
    await toggleChecked(planId, line.key, !line.checked);
    reload();
  }
  async function handleAddManual() {
    if (!label.trim()) return;
    await addManualItem(planId, label.trim());
    setLabel("");
    reload();
  }
  async function handleRemoveManual(line: GroceryLine) {
    await removeManualItem(line.key.replace(/^manual:/, ""));
    reload();
  }
  async function handleAddStaple() {
    if (!activeFamily || !stapleLabel.trim()) return;
    await addItem(activeFamily.id, stapleLabel.trim());
    setStapleLabel("");
    await reloadStaples();
    reload();
  }
  async function handleRemoveStaple(id: string) {
    await removeItem(id);
    await reloadStaples();
    reload();
  }
  async function handleSetAisle(line: GroceryLine, category: string) {
    if (!activeFamily || !category) return;
    await setCategoryOverride(activeFamily.id, line.name, category);
    reload();
  }

  const shopping = lines.filter((l) => !l.staple);
  const stapleLines = lines.filter((l) => l.staple);

  // Manual lines have no aisle and belong at the end, under Other, next to the
  // ingredients the catalog did not recognise.
  const byAisle = new Map<string, GroceryLine[]>();
  for (const l of shopping) {
    const key = l.category ?? "Other";
    byAisle.set(key, [...(byAisle.get(key) ?? []), l]);
  }
  const aisles = [...CATEGORY_ORDER.filter((c) => byAisle.has(c))];
  if (byAisle.has("Other")) aisles.push("Other");

  function lineRow(line: GroceryLine, inOther: boolean) {
    const hasScaled = line.contributions.some((c) => c.scaled);
    return (
      <li key={line.key}>
        <label>
          <input type="checkbox" checked={line.checked} onChange={() => handleToggle(line)} />
          <span style={{ textDecoration: line.checked ? "line-through" : "none" }}>{line.name}</span>
        </label>
        {inOther && activeFamily && (
          <span className="aisle-setter">
            <select
              aria-label={`Set aisle for ${line.name}`}
              value=""
              onChange={(e) => handleSetAisle(line, e.target.value)}
            >
              <option value="">Set aisle...</option>
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </span>
        )}
        {line.totals.length > 0 && (
          <span className="qty">{line.totals.map(totalLabel).join(", ")}</span>
        )}
        {/* partial also covers "one contribution could not be measured",
            which is not a mixed-unit line: saffron with a single
            "a pinch" would otherwise be labelled mixed units */}
        {line.totals.length > 1 && <span className="chip">mixed units</span>}
        {!line.manual && line.contributions.length > 0 && (
          <small>
            {" "}
            {line.contributions.map((c, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {contribLabel(c)}
                {hasScaled && !c.scaled && <span className="chip">unscaled</span>}
              </span>
            ))}
          </small>
        )}
        {line.manual && (
          <button type="button" onClick={() => handleRemoveManual(line)}>Remove</button>
        )}
      </li>
    );
  }

  return (
    <section className="plate panel note-plate">
      <h2>Grocery list</h2>
      {lines.length === 0 && <p>Pick recipes to build a grocery list.</p>}
      {aisles.length === 1 && aisles[0] === "Other" ? (
        <ul className="grocery-list stack">
          {byAisle.get("Other")!.map((line) => lineRow(line, true))}
        </ul>
      ) : (
        aisles.map((aisle) => (
          <div key={aisle}>
            <h4 className="aisle">{aisle}</h4>
            <ul className="grocery-list stack">
              {byAisle.get(aisle)!.map((line) => lineRow(line, aisle === "Other"))}
            </ul>
          </div>
        ))
      )}
      {stapleLines.length > 0 && (
        <details className="staples">
          <summary>Check you have these ({stapleLines.length})</summary>
          <ul className="grocery-list stack">
            {stapleLines.map((line) => lineRow(line, false))}
          </ul>
        </details>
      )}
      {activeFamily && (
        <details className="staples">
          <summary>Pantry staples</summary>
          <div className="chip-row">
            {staples.map((s) => (
              <span key={s.id} className="chip">
                {s.label}
                <button
                  type="button"
                  aria-label={`Remove ${s.label}`}
                  onClick={() => handleRemoveStaple(s.id)}
                >
                  x
                </button>
              </span>
            ))}
          </div>
          <div className="vault-tools" style={{ marginTop: 16, marginBottom: 0 }}>
            <input
              value={stapleLabel}
              onChange={(e) => setStapleLabel(e.target.value)}
              placeholder="Add a staple"
            />
            <button type="button" onClick={handleAddStaple}>Add</button>
          </div>
        </details>
      )}
      <div className="vault-tools" style={{ marginTop: 16, marginBottom: 0 }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add your own item" />
        <button type="button" onClick={handleAddManual}>Add item</button>
      </div>
    </section>
  );
}
