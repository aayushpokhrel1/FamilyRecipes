import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getRecipe } from "../lib/api/recipes";
import { logCooked } from "../lib/api/cookLog";
import type { Ingredient, Step } from "../lib/api/types";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection, alternativesOf } from "../lib/groupIngredients";
import { useFamily } from "../context/FamilyContext";
import { listPantry, setState as setItemState, type PantryItem } from "../lib/api/pantry";
import { normalizeItem, displayItem } from "../lib/api/normalizeItem";
import Skeleton from "../components/Skeleton";



export default function CookMode() {
  const { id } = useParams();
  const { activeFamily } = useFamily();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const isAlternative = alternativesOf(ingredients);
  const [steps, setSteps] = useState<Step[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();

  // The step number travels in the URL, not in state and not in localStorage. This repo
  // already puts anything that must survive a round trip in the URL (see src/lib/nextPath.ts),
  // and a new storage key would have to be justified as strictly necessary in
  // src/lib/browserStorage.test.ts and named on the Cookies page.
  //
  // ?step is 1-based because it is a thing a person can read and type. A URL is editable
  // input and therefore a trust boundary: anything out of range or not a number clamps into
  // range rather than throwing or rendering a blank step.
  const rawStep = Number(searchParams.get("step"));
  const index = Number.isFinite(rawStep) && rawStep >= 1
    ? Math.min(Math.trunc(rawStep) - 1, Math.max(steps.length - 1, 0))
    : 0;

  function goToStep(next: number) {
    const clamped = Math.max(0, Math.min(next, steps.length - 1));
    // replace, not push: twenty steps must not mean twenty back-button presses to leave.
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("step", String(clamped + 1));
      return params;
    }, { replace: true });
  }

  // Swipe is the same two actions as the buttons, for a phone propped on a counter. Touch
  // only: a mouse drag on a desktop is usually a text selection, not a gesture.
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    setTouchStartX(e.changedTouches[0]?.clientX ?? null);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (touchStartX === null) return;
    const delta = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    setTouchStartX(null);
    // 60px, so a tap with a slightly unsteady hand is still a tap.
    if (Math.abs(delta) < 60) return;
    goToStep(delta < 0 ? index + 1 : index - 1);
  }

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
        goToStep(index + 1);
      } else if (e.key === "ArrowLeft") {
        goToStep(index - 1);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [steps.length, index]);

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

  if (loading) return <Skeleton shape="plate" count={4} />;
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
    <div className="cook" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
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
                {grp.items.map((g, i) => {
                  const isAlt = isAlternative.has(g);
                  return (
                    <li key={i} className={isAlt ? "alt-line" : undefined}>
                      {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}{" "}
                      <span>{isAlt ? "or " + displayItem(g.item) : displayItem(g.item)}</span>
                      {g.optional === true && <span className="optional">optional</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
      {step ? (
        <>
          {/* The step IS the Next control. Cooking hands are wet, floury or greasy, and a
              normal button needs a clean fingertip; this takes a knuckle or the side of a
              hand. A real <button> with an accessible name, never a <div onClick>, which
              src/lib/accessibility.test.ts fails on. */}
          <button
            type="button"
            className="cook-step"
            onClick={() => goToStep(index + 1)}
            disabled={index >= steps.length - 1}
            aria-label={`Step ${index + 1} of ${steps.length}. Tap for the next step.`}
          >
            {step.text}
          </button>
          <p className="cook-count">
            Step {index + 1} of {steps.length}
          </p>
          <div className="cook-nav">
            <button type="button" onClick={() => goToStep(index - 1)} disabled={index === 0}>
              Previous
            </button>
            <button
              type="button"
              className="action"
              onClick={() => goToStep(index + 1)}
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
