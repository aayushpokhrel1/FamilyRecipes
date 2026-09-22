import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRecipe } from "../lib/api/recipes";
import type { Ingredient, Step } from "../lib/api/types";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection } from "../lib/groupIngredients";

export default function CookMode() {
  const { id } = useParams();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [servings, setServings] = useState<number | null>(null);
  const [factor, setFactor] = useState(1);

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
    </div>
  );
}
