import { useState } from "react";
import { recordDeviation, sendToTrial, signOff } from "../../lib/api/kitchen/dishes";
import type { Dish, Site, StaffRole } from "../../lib/api/kitchen/types";

/**
 * The three things that move a dish, and who is offered them.
 *
 * Hiding a control is a courtesy, not a guard: every one of these is refused by the database
 * for the wrong role, and the refusal is shown verbatim when it happens. If this component and
 * the database ever disagree, the database is right.
 */
export default function PipelineActions({
  dish,
  newestVersionId,
  sites,
  role,
  mySiteId = null,
  onDone,
}: {
  dish: Dish;
  newestVersionId: string | null;
  sites: Site[];
  role: StaffRole | null;
  mySiteId?: string | null;
  onDone: () => void;
}) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const writes = role === "owner" || role === "chef";

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {writes && dish.stage === "development" && (
        <div>
          <label htmlFor="trial-site">Trial at</label>
          <select id="trial-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !siteId}
            onClick={() => run(() => sendToTrial(dish.id, siteId))}
          >
            Send to trial
          </button>
        </div>
      )}

      {writes && newestVersionId && dish.stage !== "development" && (
        // Offered on a menu dish too, because that is how a NEWER version is approved after a
        // revision. The database refuses anything else.
        <button type="button" disabled={busy} onClick={() => run(() => signOff(newestVersionId))}>
          Sign off onto the menu
        </button>
      )}

      {(writes || role === "site_manager") && dish.stage !== "development" && (
        <div>
          <label htmlFor="deviation">What you had to change</label>
          <input id="deviation" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            disabled={busy || !note.trim()}
            onClick={() =>
              run(() => recordDeviation(dish.id, mySiteId ?? siteId, note.trim())).then(() =>
                setNote(""),
              )
            }
          >
            Record it
          </button>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </>
  );
}
