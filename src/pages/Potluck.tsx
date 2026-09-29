import { useEffect, useState } from "react";
import { listPublicRecipes } from "../lib/api/recipes";
import { listCoverPhotoUrls } from "../lib/api/photos";
import { getBylines } from "../lib/api/profile";
import { listFollowedCookIds } from "../lib/api/follows";
import { listSavedSourceIds, saveToVault } from "../lib/api/saves";
import { useFamily } from "../context/FamilyContext";
import type { Byline, Recipe } from "../lib/api/types";
import RecipeCard from "../components/RecipeCard";
import Skeleton from "../components/Skeleton";

const PAGE_SIZE = 24;

export default function Potluck() {
  const { activeFamily } = useFamily();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [bylines, setBylines] = useState<Map<string, Byline>>(new Map());
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"all" | "following">("all");
  const [search, setSearch] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  // Following nobody is a real answer, not a missing one: it must render the
  // "not following any cooks yet" note rather than fall back to everything.
  const [followingNobody, setFollowingNobody] = useState(false);

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    (async () => {
      let authorIds: string[] | undefined;
      if (scope === "following") {
        const ids = await listFollowedCookIds();
        if (ignore) return;
        if (ids.length === 0) {
          setFollowingNobody(true);
          setRecipes([]);
          setBylines(new Map());
          setLoading(false);
          return;
        }
        setFollowingNobody(false);
        authorIds = ids;
      } else {
        setFollowingNobody(false);
      }

      const rows = await listPublicRecipes({
        search: submitted || undefined,
        authorIds,
        limit: PAGE_SIZE,
        offset,
      });
      if (ignore) return;
      const map = await getBylines(rows.map((r) => r.id));
      if (ignore) return;
      // ONE call for the page. Same rule as the bylines above: a per-card query is an N+1
      // that only bites once a feed has more than a couple of cards.
      const saved = activeFamily
        ? await listSavedSourceIds(activeFamily.id, rows.map((r) => r.id))
        : new Set<string>();
      if (ignore) return;
      setRecipes((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setBylines((prev) => {
        const next = offset === 0 ? new Map<string, Byline>() : new Map(prev);
        for (const [id, b] of map) next.set(id, b);
        return next;
      });
      setSavedIds((prev) => {
        const next = offset === 0 ? new Set<string>() : new Set(prev);
        for (const id of saved) next.add(id);
        return next;
      });
      setLoading(false);
    })().catch(() => {
      if (ignore) return;
      setRecipes([]);
      setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, [scope, submitted, offset, activeFamily]);

  // Public recipes' photos need no new policy: recipe_photos and the storage bucket both
  // gate on can_read_recipe(), which is true for 'public'. Same shape as the vault's own
  // grid, one select plus one batch signing call, and a failure leaves the monograms in
  // place because a photo is decoration and must never stop Potluck rendering.
  useEffect(() => {
    let ignore = false;
    listCoverPhotoUrls(recipes.map((r) => r.id))
      .then((urls) => { if (!ignore) setPhotoUrls(urls); })
      .catch(() => { if (!ignore) setPhotoUrls(new Map()); });
    return () => {
      ignore = true;
    };
  }, [recipes]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSubmitted(search);
  }

  function handleScope(next: "all" | "following") {
    setScope(next);
    setOffset(0);
  }

  async function handleSave(id: string) {
    if (!activeFamily) return;
    await saveToVault(id, activeFamily.id);
    // Mark it locally rather than refetching the page: the only thing that changed is
    // this one card's state.
    setSavedIds((prev) => new Set(prev).add(id));
  }

  return (
    <div>
      <h1>Potluck</h1>
      <p className="vault-note">Everything published here, yours included.</p>

      <form onSubmit={handleSubmit}>
        <input
          aria-label="search potluck"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className="action">
          Search
        </button>
      </form>

      <div className="group-toggle">
        <button type="button" aria-pressed={scope === "all"} onClick={() => handleScope("all")}>
          All
        </button>
        <button
          type="button"
          aria-pressed={scope === "following"}
          onClick={() => handleScope("following")}
        >
          Following
        </button>
      </div>

      {loading && offset === 0 ? (
        <Skeleton shape="grid" count={6} />
      ) : scope === "following" && followingNobody ? (
        <p className="vault-note">You are not following any cooks yet.</p>
      ) : recipes.length === 0 ? (
        <p className="vault-note">No public recipes yet.</p>
      ) : (
        <>
          <ul className="plate-grid">
            {recipes.map((r) => {
              const b = bylines.get(r.id);
              return (
                <RecipeCard
                  key={r.id}
                  recipe={r}
                  showVisibility={false}
                  photoUrl={photoUrls.get(r.id) ?? null}
                  byline={b ? (b.public_name ?? "A cook") + " · " + b.family_name : undefined}
                  // No button on your own household's recipes: Potluck shows everything
                  // published, yours included, and a recipe already in your vault has
                  // nothing to save. RecipeDetail hides it on the same condition.
                  onSave={activeFamily && r.family_id !== activeFamily.id
                    ? () => handleSave(r.id)
                    : undefined}
                  saved={savedIds.has(r.id)}
                />
              );
            })}
          </ul>
          {recipes.length === offset + PAGE_SIZE && (
            <button type="button" className="action" onClick={() => setOffset(offset + PAGE_SIZE)}>
              Show more
            </button>
          )}
        </>
      )}
    </div>
  );
}
