import { Link } from "react-router-dom";
import type { Recipe } from "../lib/api/types";

export default function RecipeCard({ recipe }: { recipe: Recipe }) {
  const monogram = recipe.title.trim().charAt(0).toUpperCase() || "?";
  return (
    <li className="plate plate-card">
      <Link to={"/recipes/" + recipe.id}>
        <span className="plate-mono" aria-hidden="true">
          {monogram}
        </span>
        <span className="plate-title">{recipe.title}</span>
        <span className="chip">{recipe.visibility}</span>
      </Link>
    </li>
  );
}
