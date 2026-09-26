import { Link } from "react-router-dom";
import type { Recipe } from "../lib/api/types";

export default function RecipeCard({
  recipe,
  photoUrl,
}: {
  recipe: Recipe;
  photoUrl?: string | null;
}) {
  const monogram = recipe.title.trim().charAt(0).toUpperCase() || "?";
  return (
    <li className="plate plate-card">
      <Link to={"/recipes/" + recipe.id}>
        {photoUrl ? (
          // alt="" on purpose: the title sits right beside it as a text label,
          // so describing the dish here would just repeat it for a screen reader.
          <img className="card-photo" src={photoUrl} alt="" loading="lazy" />
        ) : (
          <span className="plate-mono" aria-hidden="true">
            {monogram}
          </span>
        )}
        <span className="plate-title">{recipe.title}</span>
        <span className="chip">{recipe.visibility}</span>
      </Link>
    </li>
  );
}
