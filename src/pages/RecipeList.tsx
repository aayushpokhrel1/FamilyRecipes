import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listRecipes } from "../lib/api/recipes";
import { listTags } from "../lib/api/tags";
import type { Recipe, Tag } from "../lib/api/types";
import RecipeCard from "../components/RecipeCard";

export default function RecipeList() {
  const { activeFamily } = useFamily();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeFamily) return;
    listTags(activeFamily.id).then(setTags).catch(() => setTags([]));
  }, [activeFamily]);

  // Debounce only the search text; the initial load and tag/family changes
  // fetch immediately (a debounced initial load made the list test flaky).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!activeFamily) return;
    setLoading(true);
    listRecipes(activeFamily.id, { search: debouncedSearch, tagId: tagId || undefined })
      .then(setRecipes)
      .finally(() => setLoading(false));
  }, [activeFamily, debouncedSearch, tagId]);

  return (
    <div>
      <h1>Recipes</h1>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search recipes"
      />
      <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
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
