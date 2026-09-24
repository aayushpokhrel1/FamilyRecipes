import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRecipe } from "../lib/api/recipes";
import { logCooked } from "../lib/api/cookLog";
import type { Ingredient, Step } from "../lib/api/types";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection } from "../lib/groupIngredients";
import { useFamily } from "../context/FamilyContext";
import { listPantry, setState as setItemState, type PantryItem } from "../lib/api/pantry";
import { normalizeItem } from "../lib/api/normalizeItem";

export default function CookMode() {
  const { id } = useParams();
  const { activeFamily } = useFamily();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [factor, setFactor] = useState(1);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [used, setUsed] = useState<PantryItem[]>([]);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
    getRecipe(id)
      .then((data) => {
        if (ignore) return;
        setIngredients(data.ingredients);
        setSteps(data.steps);
        setServings(data.recipe.servings);
      })
      .catch((err) => {
        if (ignore) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (e.key === "ArrowLeft") {
        setIndex((i) => Math.max(i - 1, 0));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [steps.length]);

  useEffect(() => {
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> } };
    const wakeLock = nav.wakeLock;
    if ("wakeLock" in nav && wakeLock) {
      (async () => {
        try {
          const l = await wakeLock.request("screen");
          if (cancelled) l.release().catch(() => {});
          else lock = l;
        } catch {
          // wake lock unavailable or denied; cooking still works
        }
      })();
    }
    return () => {
      cancelled = true;
      if (lock) lock.release().catch(() => {});
    };
  }, []);

  if (loading) return <p className="vault-note">Loading...</p>;
  if (error) return <p className="vault-note" role="alert">{error}</p>;

  const step = steps[index];

  // The only write to the cook log: an explicit tap. Opening a recipe is
  // browsing, not cooking, so nothing here logs on mount or on the last step.
  async function handleMarkCooked() {
    if (!activeFamily || !id) return;
    setLogging(true);
    setLogError(null);
    try {
      await logCooked(activeFamily.id, id);
      setLogged(true);
      // Only what this recipe actually touched. Offering the whole cupboard
      // here would be a chore rather than a prompt. The log has already
      // succeeded, so a cupboard that will not load costs nothing.
      const keys = new Set(ingredients.map((i) => normalizeItem(i.item)));
      const pantry = await listPantry(activeFamily.id);
      setUsed(pantry.filter((p) => keys.has(p.key)));
    } catch (err) {
      setLogError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogging(false);
    }
  }

  return (
    <div className="cook">
      <div className="cook-bar">
        <Link to={"/recipes/" + id} className="btn">Back to recipe</Link>
        <button type="button" onClick={() => setShowIngredients((v) => !v)}>
          {showIngredients ? "Hide ingredients" : "Show ingredients"}
        </button>
      </div>
      {showIngredients && (
        <div>
          <PortionsStepper base={servings} onFactorChange={setFactor} />
          {groupIngredientsBySection(ingredients).map((grp) => (
            <div key={grp.section ?? "_"}>
              {grp.section && <h3 className="ing-section">{grp.section}</h3>}
              <ul className="cook-ings">
                {grp.items.map((g, i) => (
                  <li key={i}>
                    {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {step ? (
        <>
          <p className="cook-step">{step.text}</p>
          <p className="cook-count">
            Step {index + 1} of {steps.length}
          </p>
          <div className="cook-nav">
            <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
              Previous
            </button>
            <button
              type="button"
              className="action"
              onClick={() => setIndex((i) => i + 1)}
              disabled={index >= steps.length - 1}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <p className="vault-note">No steps yet.</p>
      )}
      {/* Outside the steps block on purpose. Plenty of family recipes are an
          ingredient list with no method written down, and you can still cook
          one: keeping this inside made the whole cook log unreachable for them. */}
      <div className="cook-log">
        {logged ? (
          <p className="vault-note" role="status">Logged. Nice one.</p>
        ) : (
          <button
            type="button"
            onClick={handleMarkCooked}
            disabled={!activeFamily || !id || logging}
          >
            Mark as cooked
          </button>
        )}
        {logError && <p className="form-error" role="alert">{logError}</p>}
        {/* Optional extra, never a gate: the cook is already logged by the time
            this appears, and it stays out of the steps block with the button. */}
        {logged && used.length > 0 && (
          <div className="cook-used">
            <p className="vault-note">Used anything up?</p>
            {used.map((item) => (
              <button
                key={item.id}
                type="button"
                className="chip"
                aria-label={`${item.label}, mark out`}
                onClick={async () => {
                  await setItemState(item.id, "out");
                  setUsed((list) => list.filter((i) => i.id !== item.id));
                }}
              >
                {item.label} &rarr; out
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
