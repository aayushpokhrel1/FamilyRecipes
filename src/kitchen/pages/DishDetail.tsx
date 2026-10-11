import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getDish, getVersion, listVersions, menuVersionId, reviseDish,
} from "../../lib/api/kitchen/dishes";
import type { Dish, DishIngredient, DishStep, DishVersion } from "../../lib/api/kitchen/types";
import { canWriteDishes, useMyRole } from "../lib/useMyRole";
import { STAGE_WORDS } from "./Dishes";
import DishEditor from "../components/DishEditor";

export default function DishDetail() {
  const { id = "", dishId = "" } = useParams();
  const { role } = useMyRole(id);
  const [dish, setDish] = useState<Dish | null>(null);
  const [checked, setChecked] = useState(false);
  const [versions, setVersions] = useState<DishVersion[]>([]);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ ingredients: DishIngredient[]; steps: DishStep[] }>({
    ingredients: [],
    steps: [],
  });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const d = await getDish(dishId);
    setDish(d);
    setChecked(true);
    if (!d) return;
    const [vs, live] = await Promise.all([listVersions(dishId), menuVersionId(dishId)]);
    setVersions(vs);
    setLiveId(live);
    if (vs.length) setDraft(await getVersion(vs[0].id));
  }, [dishId]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await reviseDish(dishId, note.trim(), draft.ingredients, draft.steps);
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!checked) return <div className="prose plate">Loading.</div>;
  // No row came back. Either it does not exist or this viewer's role may not read it at this
  // stage, and the page deliberately does not distinguish: a cook learning that a dish exists
  // in development is the leak the read ladder is there to prevent.
  if (!dish) return <div className="prose plate"><h1>No dish here</h1></div>;

  const newest = versions[0];
  const live = versions.find((v) => v.id === liveId) ?? null;

  return (
    <div className="prose plate">
      <h1>{dish.title}</h1>
      <p>{STAGE_WORDS[dish.stage]}</p>

      {live && (
        <p>
          The sites are cooking version {live.n}.
          {newest && newest.id !== live.id && ` Version ${newest.n} is not signed off.`}
        </p>
      )}

      <h2>Versions</h2>
      <ul>
        {versions.map((v) => (
          <li key={v.id}>
            Version {v.n}
            {v.note ? `: ${v.note}` : ""} {v.id === liveId ? "(live)" : ""}
          </li>
        ))}
      </ul>

      <h2>{newest ? `Version ${newest.n}` : "Nothing written yet"}</h2>
      <ul>
        {draft.ingredients.map((row) => (
          <li key={row.position}>
            {[row.quantity, row.unit, row.item].filter(Boolean).join(" ")}
          </li>
        ))}
      </ul>
      <ol>
        {draft.steps.map((row) => (
          <li key={row.position}>{row.text}</li>
        ))}
      </ol>

      {canWriteDishes(role) && (
        <form onSubmit={save}>
          <h2>Revise</h2>
          {/* A new version every time, never an edit: that is what makes who changed what and
              why a query rather than a hope. */}
          <DishEditor ingredients={draft.ingredients} steps={draft.steps} onChange={setDraft} />
          <label htmlFor="note">What changed, and why</label>
          <input id="note" value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" disabled={busy}>
            Save a new version
          </button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
