import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listRecipes } from "../lib/api/recipes";
import type { Recipe } from "../lib/api/types";
import RecipeCard from "../components/RecipeCard";

export default function RecipeList() {
  const { activeFamily } = useFamily();
  const [search, setSearch] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeFamily) return;
    setLoading(true);
    const timer = setTimeout(() => {
      listRecipes(activeFamily.id, { search })
        .then(setRecipes)
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [activeFamily, search]);

  return (
    <div>
      <h1>Recipes</h1>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search recipes"
      />
      <Link to="/recipes/new">New recipe</Link>
      {!activeFamily && (
        <p>
          Create or join a family to see recipes. <Link to="/families">Families</Link>
        </p>
      )}
      {activeFamily && loading && <p>Loading...</p>}
      {activeFamily && !loading && recipes.length === 0 && <p>No recipes yet.</p>}
      <ul>
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} />
        ))}
      </ul>
    </div>
  );
}
