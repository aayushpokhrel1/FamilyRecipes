import { Fragment, useEffect, useState } from "react";
import { listPublicRecipes } from "../lib/api/recipes";
import { getBylines } from "../lib/api/profile";
import { listFollowedCookIds } from "../lib/api/follows";
import type { Byline, Recipe } from "../lib/api/types";
import RecipeCard from "../components/RecipeCard";

const PAGE_SIZE = 24;

export default function Potluck() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [bylines, setBylines] = useState<Map<string, Byline>>(new Map());
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
      setRecipes((prev) => (offset === 0 ? rows : [...prev, ...rows]));
      setBylines((prev) => {
        const next = offset === 0 ? new Map<string, Byline>() : new Map(prev);
        for (const [id, b] of map) next.set(id, b);
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
  }, [scope, submitted, offset]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSubmitted(search);
  }

  function handleScope(next: "all" | "following") {
    setScope(next);
    setOffset(0);
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
        <p className="vault-note">Loading...</p>
      ) : scope === "following" && followingNobody ? (
        <p className="vault-note">You are not following any cooks yet.</p>
      ) : recipes.length === 0 ? (
        <p className="vault-note">No public recipes yet.</p>
      ) : (
        <>
          <ul className="recipe-grid">
            {recipes.map((r) => {
              const b = bylines.get(r.id);
              return (
                <Fragment key={r.id}>
                  <RecipeCard recipe={r} showVisibility={false} />
                  {b && (
                    <span className="vault-note">
                      {b.public_name ?? "A cook"} &middot; {b.family_name}
                    </span>
                  )}
                </Fragment>
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
