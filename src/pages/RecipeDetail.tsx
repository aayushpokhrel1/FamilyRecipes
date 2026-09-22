import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../lib/api/recipes";
import type { Ingredient, Recipe, Step } from "../lib/api/types";
import CommentThread from "../components/CommentThread";
import PortionsStepper from "../components/PortionsStepper";
import { scaleIngredientQty } from "../lib/api/quantity";
import { groupIngredientsBySection } from "../lib/groupIngredients";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setLoading(true);
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
        <span className="chip">{recipe.visibility}</span>
      </div>

      {meta.length > 0 && (
        <div className="recipe-meta">
          {meta.map(([label, value]) => (
            <span key={label}>
              {label} <b>{value}</b>
            </span>
          ))}
        </div>
      )}

      <div className="recipe-actions">
        <Link to={"/recipes/" + id + "/cook"} className="action">
          Cook Mode
        </Link>
        <Link to={"/recipes/" + id + "/edit"} className="btn">
          Edit
        </Link>
        <span className="spacer" />
        <button type="button" onClick={handleDelete}>
          Delete
        </button>
      </div>
      {error && (
        <p className="vault-note" role="alert">
          {error}
        </p>
      )}

      <div className="recipe-body">
        <section className="plate panel">
          <h2>Ingredients</h2>
          <PortionsStepper base={recipe.servings} onFactorChange={setFactor} />
          {groupIngredientsBySection(ingredients).map((grp) => (
            <div key={grp.section ?? "_"}>
              {grp.section && <h3 className="ing-section">{grp.section}</h3>}
              <ul className="ing-list">
                {grp.items.map((g, i) => (
                  <li key={i}>
                    <span className="qty">{[scaleIngredientQty(g.quantity, factor), g.unit].filter(Boolean).join(" ")}</span>
                    <span>{g.item}</span>
                  </li>
                ))}
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

      {id && <CommentThread recipeId={id} />}
    </div>
  );
}
