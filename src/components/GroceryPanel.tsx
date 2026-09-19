import { useEffect, useState } from "react";
import { getGroceryList, toggleChecked, addManualItem, removeManualItem } from "../lib/api/mealPlans";
import type { GroceryLine } from "../lib/api/types";

function contribLabel(c: { quantity: string | null; unit: string | null; recipeTitle: string }): string {
  const qty = [c.quantity, c.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} (${c.recipeTitle})` : `(${c.recipeTitle})`;
}

export default function GroceryPanel({ planId }: { planId: string }) {
  const [lines, setLines] = useState<GroceryLine[]>([]);
  const [label, setLabel] = useState("");

  async function reload() { setLines(await getGroceryList(planId)); }
  useEffect(() => { reload(); }, [planId]);

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

  return (
    <section>
      <h2>Grocery list</h2>
      {lines.length === 0 && <p>Pick recipes to build a grocery list.</p>}
      <ul>
        {lines.map((line) => (
          <li key={line.key}>
            <label>
              <input type="checkbox" checked={line.checked} onChange={() => handleToggle(line)} />
              <span style={{ textDecoration: line.checked ? "line-through" : "none" }}>{line.name}</span>
            </label>
            {!line.manual && line.contributions.length > 0 && (
              <small> {line.contributions.map(contribLabel).join(", ")}</small>
            )}
            {line.manual && (
              <button type="button" onClick={() => handleRemoveManual(line)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      <div>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add your own item" />
        <button type="button" onClick={handleAddManual}>Add item</button>
      </div>
    </section>
  );
}
