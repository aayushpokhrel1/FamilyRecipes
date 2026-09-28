import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../lib/api/recipes";
import { getCoverPhotoUrl } from "../lib/api/photos";
import { listPlans, addRecipe } from "../lib/api/mealPlans";
import { listRecipeTags } from "../lib/api/tags";
import { listCategoryOverrides } from "../lib/api/ingredientCategories";
import { getByline } from "../lib/api/profile";
import type { Byline, Ingredient, Recipe, Step, MealPlan, Tag } from "../lib/api/types";
import CommentThread from "../components/CommentThread";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection, groupIngredientsByCategory, alternativesOf } from "../lib/groupIngredients";
import { useAuth } from "../context/AuthContext";



export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userId } = useAuth();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const isAlternative = alternativesOf(ingredients);
  const [tags, setTags] = useState<Tag[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [planId, setPlanId] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const [groupBy, setGroupBy] = useState<"recipe" | "category">("recipe");
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [byline, setByline] = useState<Byline | null>(null);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
    // Tags were write-only until now: they could be set on a recipe and filtered on in the
    // vault, but the recipe itself never showed them back, so tagging looked like it did
    // nothing. Failing to load them must not fail the recipe, hence the separate catch.
    listRecipeTags(id).then((t) => { if (!ignore) setTags(t); }).catch(() => { if (!ignore) setTags([]); });
    getRecipe(id)
      .then((data) => {
        if (ignore) return;
        setRecipe(data.recipe);
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
    if (!userId) { setPlans([]); return; }
    listPlans().then(setPlans).catch(() => setPlans([]));
  }, [userId]);

  // The byline is the thing a stranger lacks: a signed-in member already sees the family
  // context in the nav. A missing byline is normal, not an error, so a failure lands on null.
  useEffect(() => {
    if (!id || userId) { setByline(null); return; }
    let ignore = false;
    getByline(id).then((b) => { if (!ignore) setByline(b); }).catch(() => { if (!ignore) setByline(null); });
    return () => {
      ignore = true;
    };
  }, [id, userId]);

  // A recipe with no photo is normal, and a failed signing call is not a page
  // error: both resolve to null and the page renders without the image.
  useEffect(() => {
    if (!id) { setPhotoUrl(null); return; }
    let ignore = false;
    getCoverPhotoUrl(id)
      .then((url) => { if (!ignore) setPhotoUrl(url); })
      .catch(() => { if (!ignore) setPhotoUrl(null); });
    return () => {
      ignore = true;
    };
  }, [id]);

  // The family's own aisle tags, so the By category view agrees with the
  // grocery list. A failure here leaves the map empty and the list still works.
  useEffect(() => {
    if (!recipe) return;
    let ignore = false;
    listCategoryOverrides(recipe.family_id)
      .then((m) => { if (!ignore) setOverrides(m); })
      .catch(() => { if (!ignore) setOverrides(new Map()); });
    return () => {
      ignore = true;
    };
  }, [recipe?.family_id]);

  async function handleDelete() {
    if (!id) return;
    if (!window.confirm("Delete this recipe?")) return;
    setError(null);
    try {
      await deleteRecipe(id);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddToPlan() {
    if (!id || !planId) return;
    try {
      await addRecipe(planId, id);
      const name = plans.find((p) => p.id === planId)?.name ?? "plan";
      setAddMsg("Added to " + name);
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <p className="vault-note">Loading...</p>;
  if (!recipe) return <p className="vault-note">Recipe not found.</p>;

  const meta: Array<[string, number]> = [];
  if (recipe.servings) meta.push(["Serves", recipe.servings]);
  if (recipe.prep_minutes) meta.push(["Prep min", recipe.prep_minutes]);
  if (recipe.cook_minutes) meta.push(["Cook min", recipe.cook_minutes]);

  return (
    <div>
      <div className="recipe-head">
        <h1>{recipe.title}</h1>
        {userId && <span className="chip">{recipe.visibility}</span>}
      </div>

      {byline && (
        <p className="vault-note">
          {byline.public_name ?? "A cook"} &middot; {byline.family_name}
        </p>
      )}

      {meta.length > 0 && (
        <div className="recipe-meta">
          {meta.map(([label, value]) => (
            <span key={label}>
              {label} <b>{value}</b>
            </span>
          ))}
        </div>
      )}

      {userId && (
        <div className="recipe-actions">
          <Link to={"/recipes/" + id + "/cook"} className="action">
            Cook Mode
          </Link>
          <Link to={"/recipes/" + id + "/edit"} className="btn">
            Edit
          </Link>
          {plans.length > 0 && (
            <>
              <select aria-label="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Add to plan...</option>
                {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={handleAddToPlan} disabled={!planId}>Add to plan</button>
            </>
          )}
          <span className="spacer" />
          <button type="button" onClick={handleDelete}>
            Delete
          </button>
        </div>
      )}
      {error && (
        <p className="vault-note" role="alert">
          {error}
        </p>
      )}
      {addMsg && <p className="vault-note">{addMsg}</p>}

      {tags.length > 0 && (
        <div className="recipe-tags">
          {tags.map((t) => <span key={t.id} className="chip">{t.name}</span>)}
        </div>
      )}

      {photoUrl && <img className="recipe-photo" src={photoUrl} alt={recipe.title} />}

      <div className="recipe-body">
        <section className="plate panel">
          <h2>Ingredients</h2>
          <PortionsStepper base={recipe.servings} onFactorChange={setFactor} />
          <div className="group-toggle">
            <button
              type="button"
              aria-pressed={groupBy === "recipe"}
              onClick={() => setGroupBy("recipe")}
            >
              Recipe order
            </button>
            <button
              type="button"
              aria-pressed={groupBy === "category"}
              onClick={() => setGroupBy("category")}
            >
              By category
            </button>
          </div>
          {(groupBy === "category"
            ? groupIngredientsByCategory(ingredients, overrides)
            : groupIngredientsBySection(ingredients)
          ).map((grp) => (
            <div key={grp.section ?? "_"}>
              {grp.section && <h3 className="ing-section">{grp.section}</h3>}
              <ul className="ing-list">
                {grp.items.map((g, i) => {
                  if (isAlternative.has(g)) {
                    return (
                      <li key={i} className="alt-line">
                        <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                        <span>or {g.item}</span>
                        {g.optional === true && <span className="optional">optional</span>}
                      </li>
                    );
                  }
                  return (
                    <li key={i}>
                      <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                      <span>{g.item}</span>
                      {g.optional === true && <span className="optional">optional</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section className="plate panel">
          <h2>Steps</h2>
          <ol className="step-list">
            {steps.map((s, i) => (
              <li key={i}>{s.text}</li>
            ))}
          </ol>
        </section>
      </div>

      {recipe.story && (
        <section className="plate note-plate">
          <h2>Story</h2>
          <p>{recipe.story}</p>
        </section>
      )}

      {recipe.provenance && (
        <section className="plate note-plate">
          <span className="stamp">Provenance</span>
          <p>{recipe.provenance}</p>
        </section>
      )}

      {userId && id && <CommentThread recipeId={id} />}
    </div>
  );
}
