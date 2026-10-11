import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createDish, listDishes } from "../../lib/api/kitchen/dishes";
import type { Dish, DishStage } from "../../lib/api/kitchen/types";
import { canWriteDishes, useMyRole } from "../lib/useMyRole";

export const STAGE_WORDS: Record<DishStage, string> = {
  development: "In development",
  trial: "On trial",
  menu: "On the menu",
};

export default function Dishes() {
  const { id = "" } = useParams();
  const { role } = useMyRole(id);
  const [dishes, setDishes] = useState<Dish[] | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    listDishes(id)
      .then(setDishes)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, [id]);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError("Give the dish a name.");
    setBusy(true);
    try {
      const dishId = await createDish(id, title.trim());
      navigate(`/orgs/${id}/dishes/${dishId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose plate">
      <h1>Dishes</h1>
      {dishes === null ? (
        <p>Loading.</p>
      ) : dishes.length === 0 ? (
        // A cook reads nothing until a dish reaches the menu, which is the strict rule in the
        // database. Said plainly here, because an empty page with no explanation reads as a
        // broken one and this is the first thing most new staff will see.
        <p>Nothing on the menu yet.</p>
      ) : (
        <ul>
          {dishes.map((dish) => (
            <li key={dish.id}>
              <Link to={`/orgs/${id}/dishes/${dish.id}`}>{dish.title}</Link>{" "}
              <span>{STAGE_WORDS[dish.stage]}</span>
            </li>
          ))}
        </ul>
      )}

      {canWriteDishes(role) && (
        <form onSubmit={start}>
          <label htmlFor="new-dish">New dish</label>
          <input id="new-dish" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" disabled={busy}>
            Start the dish
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
