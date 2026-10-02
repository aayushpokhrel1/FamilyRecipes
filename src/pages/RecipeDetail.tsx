import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../lib/api/recipes";
import { getCoverPhotoUrl } from "../lib/api/photos";
import { listPlans, addRecipe } from "../lib/api/mealPlans";
import { listRecipeTags } from "../lib/api/tags";
import { listCategoryOverrides } from "../lib/api/ingredientCategories";
import { getByline } from "../lib/api/profile";
import type { Byline, Ingredient, Recipe, ReportReason, Step, MealPlan, Tag } from "../lib/api/types";
import { REASON_LABELS } from "../lib/api/types";
import CommentThread from "../components/CommentThread";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { displayItem } from "../lib/api/normalizeItem";
import { groupIngredientsBySection, groupIngredientsByCategory, alternativesOf } from "../lib/groupIngredients";
import { useAuth } from "../context/AuthContext";
import { useFamily } from "../context/FamilyContext";
import { saveToVault } from "../lib/api/saves";
import { reportRecipe } from "../lib/api/moderation";
import Skeleton from "../components/Skeleton";



export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { userId } = useAuth();
  const { activeFamily, families } = useFamily();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
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
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("not_a_recipe");
  const [reportNote, setReportNote] = useState("");
  const [reported, setReported] = useState(false);

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

  async function handleSave() {
    if (!id || !activeFamily) return;
    try {
      const newId = await saveToVault(id, activeFamily.id);
      // The id is what disables the button, so a second click cannot save twice.
      setSavedId(newId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReport() {
    if (!id) return;
    try {
      await reportRecipe(id, reportReason, reportNote);
      // The button is what disables itself, so a second report cannot be sent from here.
      setReported(true);
      setReportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <Skeleton shape="plate" count={4} />;
  if (!recipe) return <p className="vault-note">Recipe not found.</p>;

  // Mirrors recipes_update and recipes_delete EXACTLY: the author, or an owner of the
  // recipe's family. These controls used to render for any signed-in viewer, so a stranger
  // reading a published recipe was offered a Delete the database would refuse. RLS was never
  // the hole; the UI was lying about what it would let you do. If that policy changes, change
  // this with it.
  const canEdit = !!userId && (
    recipe.author_id === userId ||
    families.some((f) => f.id === recipe.family_id && f.role === "owner")
  );

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

      {recipe.removed_at && (
        // Silent removal is the thing people find most unfair, and this costs one field
        // rendered on a page the author already visits. The recipe is still theirs and still
        // in their vault.
        <p className="removed-banner">
          Removed from Potluck{recipe.removed_reason
            ? `: ${REASON_LABELS[recipe.removed_reason as ReportReason]}`
            : ""}. It is still in your vault.
        </p>
      )}

      {recipe.source_cook_name && (
        recipe.adapted_at
          // Adapted: the title stands alone and the credit becomes a quiet note. Permanent
          // either way, because lineage is a fact, not a decoration.
          ? <p className="credit-quiet">from {recipe.source_cook_name}</p>
          : <p className="credit">Saved from {recipe.source_cook_name}'s kitchen</p>
      )}

      {byline && (
        <p className="vault-note">
          {/* A handle can be null: public_recipe_bylines left-joins the profile precisely so
              a recipe published by a cook who never claimed one still renders. Plain text
              then, rather than a link to /cooks/null. */}
          {byline.handle
            ? <Link to={"/cooks/" + byline.handle}>{byline.public_name ?? "A cook"}</Link>
            : (byline.public_name ?? "A cook")}
          {" "}&middot; {byline.family_name}
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
          {canEdit && (
            <Link to={"/recipes/" + id + "/edit"} className="btn">
              Edit
            </Link>
          )}
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
          {canEdit && (
            <button type="button" onClick={handleDelete}>
              Delete
            </button>
          )}
        </div>
      )}
      {recipe.visibility === "public" && activeFamily && recipe.family_id !== activeFamily.id && (
        <button type="button" onClick={handleSave} disabled={savedId !== null}>
          {savedId ? "In your vault" : "Save to my vault"}
        </button>
      )}
      {/* Same visibility condition as the Save button above, deliberately: both are things
          you may only do to someone else's published recipe. */}
      {recipe.visibility === "public" && activeFamily && recipe.family_id !== activeFamily.id && (
        <div className="report-control">
          <button
            type="button"
            onClick={() => setReportOpen((open) => !open)}
            disabled={reported}
          >
            {reported ? "Reported" : "Report"}
          </button>
          {reportOpen && !reported && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleReport();
              }}
            >
              <select
                aria-label="reason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value as ReportReason)}
              >
                {(Object.keys(REASON_LABELS) as ReportReason[]).map((r) => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
              <textarea
                aria-label="note"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
              />
              <button type="submit">Submit report</button>
            </form>
          )}
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

      {/* Not alt={recipe.title}: the title is already the <h1> directly above, so repeating it
          makes a screen reader say the same words twice and still never says what the picture
          shows. Nobody can describe this photo but the cook who uploaded it, and there is no
          field for that yet, so "Photo of X" is the honest ceiling.
          ponytail: add a caption/alt field to the photo upload and use it here when present. */}
      {photoUrl && (
        <img className="recipe-photo" src={photoUrl} alt={`Photo of ${recipe.title}`} />
      )}

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
                        <span>or {displayItem(g.item)}</span>
                        {g.optional === true && <span className="optional">optional</span>}
                      </li>
                    );
                  }
                  return (
                    <li key={i}>
                      <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                      <span>{displayItem(g.item)}</span>
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
