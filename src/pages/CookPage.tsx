import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicCook } from "../lib/api/profile";
import { listPublicRecipesByAuthor } from "../lib/api/recipes";
import { follow, isFollowing, unfollow } from "../lib/api/follows";
import { useAuth } from "../context/AuthContext";
import type { PublicCook, Recipe } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

export default function CookPage() {
  const { handle } = useParams();
  const [cook, setCook] = useState<PublicCook | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const { userId } = useAuth();
  const [following, setFollowing] = useState(false);

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

  // Kept above the early returns below. A hook after a conditional return throws "Rendered
  // more hooks than during the previous render", which this repo has shipped once already.
  useEffect(() => {
    if (!cook || !userId || cook.id === userId) { setFollowing(false); return; }
    let ignore = false;
    isFollowing(cook.id)
      .then((f) => { if (!ignore) setFollowing(f); })
      .catch(() => { if (!ignore) setFollowing(false); });
    return () => { ignore = true; };
  }, [cook?.id, userId]);

  async function toggleFollow() {
    if (!cook) return;
    // Optimistic would be wrong here: a refused follow (an unpublished cook) must not leave
    // the button claiming a relationship the database does not have.
    if (following) { await unfollow(cook.id); setFollowing(false); }
    else { await follow(cook.id); setFollowing(true); }
  }

  if (loading) return <Skeleton shape="plate" count={4} />;
  if (!cook) return <p className="vault-note">Cook not found.</p>;

  return (
    <section className="plate">
      {/* The avatar route is served by the Worker. Until it exists the image is broken,
          which is why alt is empty and nothing here waits on it loading. */}
      <img className="avatar" src={"/avatar/" + cook.handle + ".jpg"} alt="" />
      <h1>{cook.public_name ?? cook.handle}</h1>
      {cook.bio && <p>{cook.bio}</p>}
      {/* Signed in, and never on your own page: following yourself is refused by a check
          constraint, so offering it would be a button that can only fail. */}
      {userId && cook.id !== userId && (
        <button type="button" className="action" onClick={toggleFollow}>
          {following ? "Following" : "Follow"}
        </button>
      )}
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
