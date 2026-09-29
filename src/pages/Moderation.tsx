import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, getPublicCooks } from "../lib/api/profile";
import { listOpenReports, resolveReport } from "../lib/api/moderation";
import { REASON_LABELS, type PublicCook, type ReportRow } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

export default function Moderation() {
  const [profile, setProfile] = useState<{ is_moderator: boolean } | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cooks, setCooks] = useState<Map<string, PublicCook>>(new Map());

  useEffect(() => {
    let ignore = false;
    (async () => {
      const p = await getMyProfile();
      if (ignore) return;
      setProfile(p);
      // Only a moderator can read the queue at all, so a non-moderator never asks for it.
      if (p.is_moderator) {
        const rows = await listOpenReports();
        if (ignore) return;
        setReports(rows);
        // ONE call for every reported cook in the queue, never one per row. public_cooks is
        // a security definer view, which is the only reason a moderator can read these names
        // at all: profiles itself is readable only to its owner.
        const ids = rows.map((r) => r.cook_id).filter((id): id is string => !!id);
        const found = await getPublicCooks(ids).catch(() => new Map<string, PublicCook>());
        if (!ignore) setCooks(found);
      }
      setLoading(false);
    })().catch(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function act(
    r: ReportRow,
    action: "unpublish" | "suspend" | "dismiss" | "clear_name",
  ) {
    await resolveReport(r.id, action, r.reason);
    // Drop the row locally rather than refetching: the only thing that changed is this
    // one report's status, and a refetch would also throw away the moderator's place.
    setReports((prev) => prev.filter((x) => x.id !== r.id));
  }

  if (loading) return <Skeleton shape="plate" count={3} />;

  // The ROUTE checks the flag rather than relying on the nav hiding the link. A hidden
  // link is not a permission: anyone can type the URL, and the nav is one refactor away
  // from showing it to everybody.
  if (!profile?.is_moderator) return <p>Not found</p>;

  return (
    <div>
      <h1>Moderation</h1>
      {reports.length === 0 ? (
        <p className="vault-note">No open reports.</p>
      ) : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id} className="plate panel">
              {r.cook_id ? (
                // A cook who has cleared their handle has no public page, so there is nothing
                // to link to: a link to /cooks/undefined is worse than plain text.
                cooks.get(r.cook_id)?.handle ? (
                  <Link to={"/cooks/" + cooks.get(r.cook_id)!.handle}>
                    {cooks.get(r.cook_id)!.public_name ?? cooks.get(r.cook_id)!.handle}
                  </Link>
                ) : (
                  <span>Unknown cook</span>
                )
              ) : (
                <Link to={"/recipes/" + r.recipe_id}>{r.recipes?.title ?? "Untitled"}</Link>
              )}
              <p className="vault-note">{REASON_LABELS[r.reason]}</p>
              {r.note && <p>{r.note}</p>}
              <div className="recipe-actions">
                {r.cook_id ? (
                  <>
                    {/* Clear name deliberately leaves the handle alone: the handle is the
                        identity in every /cooks/<handle> URL, so nulling it would break
                        every link to this cook. Only the display name is the impersonation. */}
                    <button type="button" onClick={() => act(r, "clear_name")}>Clear name</button>
                    <button type="button" onClick={() => act(r, "suspend")}>Suspend cook</button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => act(r, "unpublish")}>Unpublish</button>
                    <button type="button" onClick={() => act(r, "suspend")}>Suspend cook</button>
                  </>
                )}
                <button type="button" onClick={() => act(r, "dismiss")}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
