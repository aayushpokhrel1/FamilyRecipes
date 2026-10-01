import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listRecipes } from "../lib/api/recipes";
import { listCoverPhotoUrls } from "../lib/api/photos";
import { listTags } from "../lib/api/tags";
import { listDrafts } from "../lib/api/drafts";
import type { Recipe, Tag } from "../lib/api/types";
import RecipeCard from "../components/RecipeCard";
import Skeleton from "../components/Skeleton";

export default function RecipeList() {
  const { activeFamily } = useFamily();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tagId, setTagId] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [draftCount, setDraftCount] = useState(0);

  // A failed draft count must never break the recipe list, so the catch leaves the
  // count at zero and the link simply does not render.
  useEffect(() => {
    listDrafts()
      .then((d) => setDraftCount(d.length))
      .catch(() => setDraftCount(0));
  }, []);

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

  // One select and one batch signing call for the whole list. Photos are
  // decoration: a failed signing call must never stop the vault rendering, so
  // the catch leaves the monograms in place.
  useEffect(() => {
    let ignore = false;
    listCoverPhotoUrls(recipes.map((r) => r.id))
      .then((urls) => { if (!ignore) setPhotoUrls(urls); })
      .catch(() => { if (!ignore) setPhotoUrls(new Map()); });
    return () => {
      ignore = true;
    };
  }, [recipes]);

  return (
    <div>
      <h1>Recipes</h1>
      <div className="vault-tools">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or ingredient"
        />
        <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <Link to="/recipes/new" className="action">
          New recipe
        </Link>
        {/* Only when there is something to resume. An empty room does not need a sign
            advertising it. */}
        {draftCount > 0 && (
          <Link to="/drafts">{draftCount} unfinished drafts</Link>
        )}
      </div>
      {!activeFamily && (
        <p className="vault-note">
          Create or join a family to see recipes. <Link to="/families">Families</Link>
        </p>
      )}
      {/* First paint only. Re-running a search keeps the current plates on screen: swapping
          them for skeletons on every debounced keystroke would flash the whole grid to
          describe a wait the reader is not having. */}
      {activeFamily && loading && recipes.length === 0 && <Skeleton shape="grid" count={6} />}
      {activeFamily && !loading && recipes.length === 0 && (
        <p className="vault-note">No recipes yet.</p>
      )}
      <ul className="plate-grid">
        {recipes.map((r) => (
          <RecipeCard key={r.id} recipe={r} photoUrl={photoUrls.get(r.id) ?? null} />
        ))}
      </ul>
    </div>
  );
}
