// ponytail: this duplicates part of GroceryPanel's rendering. The two were kept
// separate because the data sources differ (one plan vs. every readable plan in
// the window) and so do the checked-state writes (toggleChecked vs.
// toggleCheckedAcross). Merge them if a third caller ever appears.
import { useEffect, useState } from "react";
import { getUpcomingGroceryList, toggleCheckedAcross } from "../lib/api/mealPlans";
import type { GroceryLine } from "../lib/api/types";
import { CATEGORY_ORDER } from "../lib/catalog";

function contribLabel(c: { quantity: string | null; unit: string | null; recipeTitle: string }): string {
  const qty = [c.quantity, c.unit].filter(Boolean).join(" ").trim();
  return qty ? `${qty} (${c.recipeTitle})` : `(${c.recipeTitle})`;
}

function totalLabel(t: { quantity: string; unit: string }): string {
  return [t.quantity, t.unit].filter(Boolean).join(" ").trim();
}

export default function UpcomingGroceryPanel({ days }: { days: number }) {
  const [lines, setLines] = useState<GroceryLine[]>([]);
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function reload() {
    setLoading(true);
    try {
      const { lines, planIds } = await getUpcomingGroceryList(days);
      setLines(lines);
      setPlanIds(planIds);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the shopping list.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { reload(); }, [days]);

  async function handleToggle(line: GroceryLine) {
    await toggleCheckedAcross(planIds, line.key, !line.checked);
    reload();
  }

  const shopping = lines.filter((l) => !l.staple);
  const stapleLines = lines.filter((l) => l.staple);

  // Lines the catalog has not seen have no aisle and belong at the end, under
  // Other.
  const byAisle = new Map<string, GroceryLine[]>();
  for (const l of shopping) {
    const key = l.category ?? "Other";
    byAisle.set(key, [...(byAisle.get(key) ?? []), l]);
  }
  const aisles = [...CATEGORY_ORDER.filter((c) => byAisle.has(c))];
  if (byAisle.has("Other")) aisles.push("Other");

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
      </li>
    );
  }

  return (
    <div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!error && !loading && lines.length === 0 && (
        <p className="vault-note">Nothing to buy for the next few days.</p>
      )}
      {aisles.map((aisle) => (
        <div key={aisle}>
          <h4 className="aisle">{aisle}</h4>
          <ul className="grocery-list stack">
            {byAisle.get(aisle)!.map((line) => lineRow(line))}
          </ul>
        </div>
      ))}
      {stapleLines.length > 0 && (
        <details className="staples">
          <summary>Check you have these ({stapleLines.length})</summary>
          <ul className="grocery-list stack">
            {stapleLines.map((line) => lineRow(line))}
          </ul>
        </details>
      )}
    </div>
  );
}
