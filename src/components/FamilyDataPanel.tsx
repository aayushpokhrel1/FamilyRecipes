import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import {
  listCategoryOverrides, setCategoryOverride, removeCategoryOverride,
} from "../lib/api/ingredientCategories";
import { listFamilySectionNames } from "../lib/api/recipes";
import { CATEGORY_ORDER } from "../lib/catalog";

export default function FamilyDataPanel() {
  const { activeFamily } = useFamily();
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [sections, setSections] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const familyId = activeFamily?.id;

  // One load for both groups, and one reload the mutations call, so the panel
  // can never show a tag that was just removed.
  async function reload() {
    if (!familyId) return;
    const [tags, used] = await Promise.all([
      listCategoryOverrides(familyId),
      listFamilySectionNames(familyId),
    ]);
    setOverrides(tags);
    setSections(used);
  }

  useEffect(() => {
    if (!familyId) return;
    setError(null);
    reload().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [familyId]);

  // Every mutation reports the same way: the API layer already writes
  // user-facing messages, so show the thrown message verbatim.
  async function run(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSetCategory(key: string, category: string) {
    if (!familyId || !category) return;
    await run(() => setCategoryOverride(familyId, key, category));
  }

  async function handleRemoveCategory(key: string) {
    if (!familyId) return;
    await run(() => removeCategoryOverride(familyId, key));
  }

  if (!activeFamily) {
    return <p className="vault-note">Join a family to manage its shopping data.</p>;
  }

  const keys = [...overrides.keys()].sort();

  return (
    <div>
      {error && <p className="form-error" role="alert">{error}</p>}

      <h3>Aisle tags</h3>
      {keys.length === 0 ? (
        <p className="vault-note">
          No aisle tags yet. Tag an ingredient from the grocery list and it will show up here.
        </p>
      ) : (
        keys.map((key) => (
          <div key={key} className="data-row">
            <span className="key">{key}</span>
            <span className="chip">{overrides.get(key)}</span>
            <select
              aria-label={`Change aisle for ${key}`}
              value={overrides.get(key)}
              onChange={(e) => handleSetCategory(key, e.target.value)}
            >
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button type="button" onClick={() => handleRemoveCategory(key)}>Remove</button>
          </div>
        ))
      )}

      <h3>The cupboard</h3>
      <p className="vault-note">
        What your family keeps in, and what is in right now, is managed in{" "}
        <Link to="/kitchen/cupboard">the cupboard</Link>.
      </p>

      <h3>Recipe sections in use</h3>
      <p className="vault-note">
        Sections are the parts of a recipe, like Sauce or Filling. These are the ones your
        family has actually used.
      </p>
      {sections.length === 0 ? (
        <p className="vault-note">No sections used yet.</p>
      ) : (
        <div className="chip-row">
          {sections.map((name) => <span key={name} className="chip">{name}</span>)}
        </div>
      )}
    </div>
  );
}
