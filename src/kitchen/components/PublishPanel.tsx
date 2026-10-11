import { useState } from "react";
import { publishDish, unpublishDish } from "../../lib/api/kitchen/dishes";
import type { Dish, Snapshot, StaffRole } from "../../lib/api/kitchen/types";

// The public catalogue lives on the APP host, not this one, so the link is absolute and
// hardcoded rather than built from window.location. In dev it therefore points at production,
// where a local recipe id does not exist: that is expected, and the published row is still
// checkable in the local database.
export const APP_ORIGIN = "https://recipes.enamelvault.com";

/**
 * Publishing is the OWNER's alone: it is a marketing act with a legal surface, not a kitchen
 * act. A chef signs dishes onto the menu but does not speak publicly for the business.
 *
 * What goes out is the version the sites are cooking, which is the latest APPROVED one, never
 * the newest. Publishing a draft nobody signed off would be the worst version of this feature.
 */
export default function PublishPanel({
  dish,
  menuVersionId,
  snapshot,
  role,
  onDone,
}: {
  dish: Dish;
  menuVersionId: string | null;
  snapshot: Snapshot | null;
  role: StaffRole | null;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (role !== "owner") return null;

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
      <h2>Publishing</h2>
      {snapshot ? (
        <>
          <p>
            Published at {APP_ORIGIN}/recipes/{snapshot.recipe_id}
          </p>
          {/* Re-publishing updates the same row, so the link you sent keeps working. */}
          {menuVersionId && menuVersionId !== snapshot.version_id && (
            <button type="button" disabled={busy} onClick={() => run(() => publishDish(menuVersionId))}>
              Publish the current version
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => run(() => unpublishDish(dish.id))}>
            Take it down
          </button>
        </>
      ) : menuVersionId ? (
        <button type="button" disabled={busy} onClick={() => run(() => publishDish(menuVersionId))}>
          Publish to Potluck
        </button>
      ) : (
        <p>Sign a version off before publishing it.</p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
