import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  getDish, getSnapshot, getVersion, listDeviations, listVersions, menuVersionId, retireDish,
  reviseDish, unretireDish,
} from "../../lib/api/kitchen/dishes";
import { listSites, listStaff } from "../../lib/api/kitchen/orgs";
import type {
  Deviation, Dish, DishIngredient, DishStep, DishVersion, Site, Snapshot,
} from "../../lib/api/kitchen/types";
import { canWriteDishes, useMyRole } from "../lib/useMyRole";
import { STAGE_WORDS } from "./Dishes";
import DishEditor from "../components/DishEditor";
import PipelineActions from "../components/PipelineActions";
import PublishPanel from "../components/PublishPanel";
import { useAuth } from "../../context/AuthContext";

export default function DishDetail() {
  const { id = "", dishId = "" } = useParams();
  const { role } = useMyRole(id);
  const { userId } = useAuth();
  const [dish, setDish] = useState<Dish | null>(null);
  const [checked, setChecked] = useState(false);
  const [versions, setVersions] = useState<DishVersion[]>([]);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [deviations, setDeviations] = useState<Deviation[]>([]);
  const [mySiteId, setMySiteId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<{ ingredients: DishIngredient[]; steps: DishStep[] }>({
    ingredients: [],
    steps: [],
  });
  const [shownId, setShownId] = useState<string | null>(null);
  const [shown, setShown] = useState<{ ingredients: DishIngredient[]; steps: DishStep[] }>({
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
    // TWO versions are in play and they are not the same thing. `shown` is what the sites
    // are cooking, which is the latest APPROVED version, and it is what the read-only part
    // of this page lists: a site manager or a cook reading it is the person who actually
    // cooks the dish. `draft` is the NEWEST version, which seeds the editor a chef revises
    // from. Listing the newest to everyone was shipped on 2026-10-11 and caught in a
    // browser: the page said the sites were cooking version 1 and then showed version 2's
    // quantities underneath.
    const showId = live ?? vs[0]?.id ?? null;
    setShownId(showId);
    const newestContents = vs.length ? await getVersion(vs[0].id) : { ingredients: [], steps: [] };
    setDraft(newestContents);
    setShown(
      showId && showId !== vs[0]?.id ? await getVersion(showId) : newestContents,
    );
    const [siteRows, deviationRows, staff] = await Promise.all([
      listSites(id),
      listDeviations(dishId),
      // The viewer's own site decides what a site manager may record. A viewer with no staff
      // row, or a build where the roster is not readable, simply has no site of their own.
      listStaff(id),
    ]);
    setSites(siteRows);
    setDeviations(deviationRows);
    setMySiteId(staff.find((s) => s.user_id === userId)?.site_id ?? null);
    setSnapshot(await getSnapshot(dishId));
  }, [dishId, id, userId]);

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

  async function retire(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
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
  const shownVersion = versions.find((v) => v.id === shownId) ?? newest ?? null;
  // Retiring is about the group's own menu, not about the public: the database refuses
  // send_to_trial and sign_off for a retired dish and deliberately still allows publishing,
  // so the publish panel below is untouched. Only an owner or a chef may retire or bring back.
  const retired = dish.retired_at !== null;
  const mayRetire = role === "owner" || role === "chef";

  return (
    <div className="prose plate">
      <h1>{dish.title}</h1>
      <p>
        {STAGE_WORDS[dish.stage]}
        {retired && " — Retired"}
      </p>

      {live && (
        <p>
          The sites are cooking version {live.n}.
          {newest && newest.id !== live.id && ` Version ${newest.n} is not signed off.`}
        </p>
      )}

      {mayRetire && (
        <p>
          {retired ? (
            <button type="button" disabled={busy} onClick={() => retire(() => unretireDish(dish.id))}>
              Bring it back
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => retire(() => retireDish(dish.id))}>
              Retire
            </button>
          )}
        </p>
      )}

      {/* A retired dish is refused by send_to_trial and sign_off, so those two controls are
          not offered at all: a page must never offer a control its viewer's policy refuses.
          The deviation control is still allowed, so PipelineActions still renders. */}
      {!retired && (
        <PipelineActions
          dish={dish}
          newestVersionId={newest?.id ?? null}
          sites={sites}
          role={role}
          mySiteId={mySiteId}
          onDone={() => void load()}
        />
      )}

      {deviations.length > 0 && (
        <>
          <h2>What sites changed</h2>
          <ul>
            {deviations.map((d) => (
              <li key={d.id}>
                {sites.find((s) => s.id === d.site_id)?.name ?? "A site"}: {d.note}
              </li>
            ))}
          </ul>
        </>
      )}

      <PublishPanel
        dish={dish}
        menuVersionId={liveId}
        snapshot={snapshot}
        role={role}
        onDone={() => void load()}
      />

      <h2>Versions</h2>
      <ul>
        {versions.map((v) => (
          <li key={v.id}>
            Version {v.n}
            {v.note ? `: ${v.note}` : ""} {v.id === liveId ? "(live)" : ""}
          </li>
        ))}
      </ul>

      <h2>
        {shownVersion
          ? `Version ${shownVersion.n}${shownVersion.id === liveId ? " (live)" : ""}`
          : "Nothing written yet"}
      </h2>
      <ul>
        {shown.ingredients.map((row) => (
          <li key={row.position}>
            {[row.quantity, row.unit, row.item].filter(Boolean).join(" ")}
          </li>
        ))}
      </ul>
      <ol>
        {shown.steps.map((row) => (
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
