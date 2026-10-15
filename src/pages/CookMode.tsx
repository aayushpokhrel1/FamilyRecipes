import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { getRecipe } from "../lib/api/recipes";
import { logCooked } from "../lib/api/cookLog";
import type { Ingredient, Step } from "../lib/api/types";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection, alternativesOf, ingredientsForStep } from "../lib/groupIngredients";
import { useFamily } from "../context/FamilyContext";
import { listPantry, setState as setItemState, type PantryItem } from "../lib/api/pantry";
import { normalizeItem, displayItem } from "../lib/api/normalizeItem";
import Skeleton from "../components/Skeleton";
import { findDurations } from "../lib/stepDuration";
import { start as startTimer, findRunning, subscribe as subscribeTimers } from "../lib/cookTimers";
import { armAlarm } from "../lib/cookAlarm";



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
  const [title, setTitle] = useState("");
  // The timer store is module-level and outlives this page, so this screen has to be TOLD
  // when it changes rather than owning the state. Without this a chip would not flip to
  // "running" until something else re-rendered the page.
  const [timerTick, setTimerTick] = useState(0);
  const [factor, setFactor] = useState(1);
  const [logging, setLogging] = useState(false);
  const [logged, setLogged] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [used, setUsed] = useState<PantryItem[]>([]);

  // Ticked off as you add it, which is the only thing on this screen that answers "did I
  // already put the salt in?". Keyed by normalized name so the same ingredient ticks in
  // both the inline list and the full panel at once.
  //
  // DELIBERATELY NOT PERSISTED, and not reset between steps. It is per-cook: leaving the
  // screen clears it, because a half-ticked list greeting you next time is worse than
  // starting clean, and you may well add an ingredient during step 2 and want it still
  // ticked at step 5.
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  function toggleTicked(item: string) {
    const key = normalizeItem(item);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => subscribeTimers(() => setTimerTick((n) => n + 1)), []);

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
        setTitle(data.recipe.title);
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
      <div className={showIngredients ? "cook-body cook-body-split" : "cook-body"}>
        <div className="cook-main">
          {step ? (
            <>
              {/* The step IS the Next control. Cooking hands are wet, floury or greasy, and a
                  normal button needs a clean fingertip; this takes a knuckle or the side of a
                  hand. A real <button> with an accessible name, never a <div onClick>, which
                  src/lib/accessibility.test.ts fails on.

              Its label deliberately does NOT say "next". The explicit Next button below says
              that, and two controls announcing the same word is what a screen reader reads
              out twice with no way to tell them apart. */}
              <button
                type="button"
                className="cook-step"
                onClick={() => goToStep(index + 1)}
                disabled={index >= steps.length - 1}
                aria-label={`Advance from step ${index + 1} of ${steps.length}`}
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
          {/* Only what THIS step mentions, so the amount is next to the instruction without
              opening anything. An empty match renders nothing at all rather than guessing:
              the full list is one tap away in the panel, and a wrong ingredient under a step
              is worse than none. */}
          {step && ingredientsForStep(ingredients, step.text).length > 0 && (
            <ul className="cook-step-ings">
              {ingredientsForStep(ingredients, step.text).map((g, i) => {
                const key = normalizeItem(g.item);
                const isTicked = ticked.has(key);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      className={isTicked ? "cook-tick is-ticked" : "cook-tick"}
                      aria-pressed={isTicked}
                      onClick={() => toggleTicked(g.item)}
                    >
                      {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}{" "}
                      {displayItem(g.item)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* OUTSIDE the cook-step button, and that is not cosmetic: the step text IS the
              Next control, so a tappable duration inside it would nest one interactive
              element in another. src/lib/accessibility.test.ts fails on that, and it would
              make the step itself unreliable to tap with the side of a floury hand. */}
          {step && findDurations(step.text).length > 0 && (
            <ul className="cook-timer-chips" key={timerTick}>
              {findDurations(step.text).map((d) => {
                const running = findRunning(id ?? "", index + 1, d.index);
                return (
                  <li key={d.index}>
                    {running ? (
                      <span className="chip is-running">{d.label}, running</span>
                    ) : (
                      <button
                        type="button"
                        className="chip"
                        aria-label={`Start a ${d.label} timer for step ${index + 1}`}
                        onClick={() => {
                          // The gesture that makes the beep legal twenty minutes from now.
                          // See the comment at the top of src/lib/cookAlarm.ts: autoplay
                          // policy silently suppresses audio with no gesture behind it.
                          armAlarm();
                          startTimer({
                            recipeId: id ?? "",
                            recipeTitle: title,
                            stepNumber: index + 1,
                            label: d.label,
                            matchIndex: d.index,
                            seconds: d.seconds,
                          });
                        }}
                      >
                        {d.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {showIngredients && (
          <div className="cook-aside">
            <PortionsStepper base={servings} onFactorChange={setFactor} />
            {groupIngredientsBySection(ingredients).map((grp) => (
              <div key={grp.section ?? "_"}>
                {grp.section && <h3 className="ing-section">{grp.section}</h3>}
                <ul className="cook-ings">
                  {grp.items.map((g, i) => {
                    const isAlt = isAlternative.has(g);
                    return (
                      <li key={i} className={isAlt ? "alt-line" : undefined}>
                        <button
                          type="button"
                          className={ticked.has(normalizeItem(g.item)) ? "cook-tick is-ticked" : "cook-tick"}
                          aria-pressed={ticked.has(normalizeItem(g.item))}
                          onClick={() => toggleTicked(g.item)}
                        >
                          {[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}{" "}
                          <span>{isAlt ? "or " + displayItem(g.item) : displayItem(g.item)}</span>
                          {g.optional === true && <span className="optional">optional</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
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
