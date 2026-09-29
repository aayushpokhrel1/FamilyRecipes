import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile } from "../lib/api/profile";
import { listOpenReports, resolveReport } from "../lib/api/moderation";
import { REASON_LABELS, type ReportRow } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

export default function Moderation() {
  const [profile, setProfile] = useState<{ is_moderator: boolean } | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

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
      }
      setLoading(false);
    })().catch(() => {
      if (!ignore) setLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, []);

  async function act(r: ReportRow, action: "unpublish" | "suspend" | "dismiss") {
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
              <Link to={"/recipes/" + r.recipe_id}>{r.recipes?.title ?? "Untitled"}</Link>
              <p className="vault-note">{REASON_LABELS[r.reason]}</p>
              {r.note && <p>{r.note}</p>}
              <div className="recipe-actions">
                <button type="button" onClick={() => act(r, "unpublish")}>Unpublish</button>
                <button type="button" onClick={() => act(r, "suspend")}>Suspend cook</button>
                <button type="button" onClick={() => act(r, "dismiss")}>Dismiss</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
