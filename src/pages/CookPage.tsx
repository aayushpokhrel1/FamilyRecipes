import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicCook } from "../lib/api/profile";
import { listPublicRecipesByAuthor } from "../lib/api/recipes";
import type { PublicCook, Recipe } from "../lib/api/types";

export default function CookPage() {
  const { handle } = useParams();
  const [cook, setCook] = useState<PublicCook | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handle) {
      setCook(null);
      setLoading(false);
      return;
    }
    let ignore = false;
    setLoading(true);
    // A missing cook and a failed lookup are the same page, so both land on null rather
    // than an error: an unknown handle and an unpublished cook must read identically.
    getPublicCook(handle)
      .then((c) => {
        if (ignore) return;
        setCook(c);
        if (!c) return;
        // Caught separately from the lookup above, and deliberately. A failed RECIPE list
        // must not turn into "Cook not found.", which would deny that a cook who plainly
        // exists exists, on nothing worse than a transient network error. The cook stays,
        // the list is empty.
        return listPublicRecipesByAuthor(c.id)
          .then((r) => { if (!ignore) setRecipes(r); })
          .catch(() => { if (!ignore) setRecipes([]); });
      })
      .catch(() => {
        if (ignore) return;
        setCook(null);
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [handle]);

  if (loading) return <p className="vault-note">Loading...</p>;
  if (!cook) return <p className="vault-note">Cook not found.</p>;

  return (
    <section className="plate">
      {/* The avatar route is served by the Worker. Until it exists the image is broken,
          which is why alt is empty and nothing here waits on it loading. */}
      <img className="avatar" src={"/avatar/" + cook.handle + ".jpg"} alt="" />
      <h1>{cook.public_name ?? cook.handle}</h1>
      {cook.bio && <p>{cook.bio}</p>}
      {recipes.length > 0 ? (
        <ul className="stack">
          {recipes.map((r) => (
            <li key={r.id}>
              <Link to={"/recipes/" + r.id}>{r.title}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="vault-note">No published recipes yet.</p>
      )}
    </section>
  );
}
