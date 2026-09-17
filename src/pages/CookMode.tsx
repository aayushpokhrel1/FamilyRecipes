import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getRecipe } from "../lib/api/recipes";
import type { Ingredient, Step } from "../lib/api/types";

export default function CookMode() {
  const { id } = useParams();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [index, setIndex] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
    getRecipe(id)
      .then((data) => {
        if (ignore) return;
        setIngredients(data.ingredients);
        setSteps(data.steps);
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

  if (loading) return <p>Loading...</p>;
  if (error) return <p role="alert">{error}</p>;

  const step = steps[index];

  return (
    <div>
      <Link to={"/recipes/" + id}>Back to recipe</Link>
      <button type="button" onClick={() => setShowIngredients((v) => !v)}>
        {showIngredients ? "Hide ingredients" : "Show ingredients"}
      </button>
      {showIngredients && (
        <ul>
          {ingredients.map((g, i) => (
            <li key={i}>
              {[g.quantity, g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
            </li>
          ))}
        </ul>
      )}
      {step ? (
        <>
          <p style={{ fontSize: "2rem" }}>{step.text}</p>
          <p>
            Step {index + 1} of {steps.length}
          </p>
          <button type="button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0}>
            Previous
          </button>
          <button
            type="button"
            onClick={() => setIndex((i) => i + 1)}
            disabled={index >= steps.length - 1}
          >
            Next
          </button>
        </>
      ) : (
        <p>No steps yet.</p>
      )}
    </div>
  );
}
