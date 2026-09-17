import { Link } from "react-router-dom";
import type { Recipe } from "../lib/api/types";

export default function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <li>
      <Link to={"/recipes/" + recipe.id}>{recipe.title}</Link>{" "}
      <small>{recipe.visibility}</small>
    </li>
  );
}
