import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { deleteRecipe, getRecipe } from "../lib/api/recipes";
import type { Ingredient, Recipe, Step } from "../lib/api/types";
import CommentThread from "../components/CommentThread";

export default function RecipeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (loading) return <p>Loading...</p>;
  if (!recipe) return <p>Recipe not found.</p>;

  return (
    <div>
      <h1>{recipe.title}</h1>
      <p>{recipe.visibility}</p>
      {error && <p role="alert">{error}</p>}
      <Link to={"/recipes/" + id + "/cook"}>Cook Mode</Link>
      <Link to={"/recipes/" + id + "/edit"}>Edit</Link>
      <button type="button" onClick={handleDelete}>
        Delete
      </button>
      <h2>Ingredients</h2>
      <ul>
        {ingredients.map((g, i) => (
          <li key={i}>
            {[g.quantity, g.unit].filter(Boolean).join(" ")} <span>{g.item}</span>
          </li>
        ))}
      </ul>
      <h2>Steps</h2>
      <ol>
        {steps.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ol>
      {recipe.story && (
        <>
          <h2>Story</h2>
          <p>{recipe.story}</p>
        </>
      )}
      {recipe.provenance && (
        <>
          <h2>Provenance</h2>
          <p>{recipe.provenance}</p>
        </>
      )}
      {id && <CommentThread recipeId={id} />}
    </div>
  );
}
