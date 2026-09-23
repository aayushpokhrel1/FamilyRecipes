import { useEffect, useState } from "react";
import { getGroceryList, toggleChecked, addManualItem, removeManualItem } from "../lib/api/mealPlans";
import { listStaples, addStaple, removeStaple, type Staple } from "../lib/api/staples";
import { useFamily } from "../context/FamilyContext";
import type { GroceryLine } from "../lib/api/types";

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
  const [staples, setStaples] = useState<Staple[]>([]);
  const [stapleLabel, setStapleLabel] = useState("");

  async function reload() { setLines(await getGroceryList(planId)); }
  useEffect(() => { reload(); }, [planId]);

  async function reloadStaples() {
    if (!activeFamily) { setStaples([]); return; }
    setStaples(await listStaples(activeFamily.id));
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
    await addStaple(activeFamily.id, stapleLabel.trim());
    setStapleLabel("");
    await reloadStaples();
    reload();
  }
  async function handleRemoveStaple(id: string) {
    await removeStaple(id);
    await reloadStaples();
    reload();
  }

  const shopping = lines.filter((l) => !l.staple);
  const stapleLines = lines.filter((l) => l.staple);

  function lineRow(line: GroceryLine) {
    const hasScaled = line.contributions.some((c) => c.scaled);
    return (
      <li key={line.key}>
        <label>
          <input type="checkbox" checked={line.checked} onChange={() => handleToggle(line)} />
          <span style={{ textDecoration: line.checked ? "line-through" : "none" }}>{line.name}</span>
        </label>
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
      <ul className="grocery-list stack">
        {shopping.map((line) => lineRow(line))}
      </ul>
      {stapleLines.length > 0 && (
        <details className="staples">
          <summary>Check you have these ({stapleLines.length})</summary>
          <ul className="grocery-list stack">
            {stapleLines.map((line) => lineRow(line))}
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
