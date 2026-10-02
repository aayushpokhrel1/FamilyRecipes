import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPublicCook } from "../lib/api/profile";
import { listPublicRecipesByAuthor } from "../lib/api/recipes";
import { follow, isFollowing, unfollow } from "../lib/api/follows";
import { listMyBlocks, removeBlock, setBlock } from "../lib/api/blocks";
import { reportCook } from "../lib/api/moderation";
import { useAuth } from "../context/AuthContext";
import { REASON_LABELS, type PublicCook, type Recipe, type ReportReason } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

export default function CookPage() {
  const { handle } = useParams();
  const [cook, setCook] = useState<PublicCook | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const { userId } = useAuth();
  const [following, setFollowing] = useState(false);
  // null means neither muted nor blocked. One piece of state, not two booleans: the table is
  // one row with a kind, so two flags could disagree with it and with each other.
  const [blockKind, setBlockKind] = useState<"mute" | "block" | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("impersonation");
  const [reportNote, setReportNote] = useState("");
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Kept above the early returns for the same reason as the follow effect above. A revisited
  // page has to read back as Muted or Blocked rather than offering it again.
  useEffect(() => {
    if (!cook || !userId || cook.id === userId) { setBlockKind(null); return; }
    let ignore = false;
    listMyBlocks()
      .then((rows) => {
        if (ignore) return;
        const mine = rows.find((b) => b.blocked_id === cook.id);
        setBlockKind(mine ? mine.kind : null);
      })
      .catch(() => { if (!ignore) setBlockKind(null); });
    return () => { ignore = true; };
  }, [cook?.id, userId]);

  async function toggleFollow() {
    if (!cook) return;
    // Optimistic would be wrong here: a refused follow (an unpublished cook) must not leave
    // the button claiming a relationship the database does not have.
    if (following) { await unfollow(cook.id); setFollowing(false); }
    else { await follow(cook.id); setFollowing(true); }
  }

  // Not optimistic, for the same reason as toggleFollow: a refused write must not leave the
  // control claiming a mute or a block the database does not have.
  async function toggleBlock(kind: "mute" | "block") {
    if (!cook) return;
    try {
      if (blockKind === kind) { await removeBlock(cook.id); setBlockKind(null); }
      else {
        await setBlock(cook.id, kind);
        setBlockKind(kind);
        // A block severs the follow SERVER side (see 0029), so the button has to stop saying
        // "Following" or it is reporting a relationship the database has already deleted.
        // Found on production: block, and the control still read Following until a reload.
        // Unblocking deliberately does NOT restore it, because the follow is gone, not paused.
        if (kind === "block") setFollowing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleReport() {
    if (!cook) return;
    try {
      await reportCook(cook.id, reportReason, reportNote);
      setReported(true);
      setReportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (loading) return <Skeleton shape="plate" count={4} />;
  if (!cook) return <p className="vault-note">Cook not found.</p>;

  return (
    <section className="plate">
      {/* The avatar route is served by the Worker. Until it exists the image is broken,
          which is why alt is empty and nothing here waits on it loading. */}
      {/* alt="" is DELIBERATE: the handle and display name are text immediately beside this,
          so "avatar of X" would just repeat them. */}
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
      {/* Signed in, and never on your own page: the same condition as Follow above, and for
          the same reason. A self-block is refused by a check constraint. */}
      {userId && cook.id !== userId && (
        <div className="report-control">
          <button type="button" className="action" onClick={() => toggleBlock("mute")}>
            {blockKind === "mute" ? "Muted" : "Mute"}
          </button>
          <p className="vault-note">You will not see their recipes in Potluck.</p>
          <button type="button" className="action" onClick={() => toggleBlock("block")}>
            {blockKind === "block" ? "Blocked" : "Block"}
          </button>
          {/* "will not see", NEVER "cannot see". Their public recipes stay readable to anyone
              signed out, so the stronger claim would be a promise the architecture cannot
              keep. Pinned by the CookPage test "the block copy promises only what the
              architecture can keep". */}
          <p className="vault-note">They will not see your recipes in Potluck.</p>
          <button
            type="button"
            className="action"
            onClick={() => setReportOpen((open) => !open)}
            disabled={reported}
          >
            {reported ? "Reported" : "Report"}
          </button>
          {reportOpen && !reported && (
            <form onSubmit={(e) => { e.preventDefault(); handleReport(); }}>
              <select
                aria-label="reason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value as ReportReason)}
              >
                {(Object.keys(REASON_LABELS) as ReportReason[]).map((r) => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
              <textarea
                aria-label="note"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
              />
              <button type="submit">Submit report</button>
            </form>
          )}
        </div>
      )}
      {error && <p className="vault-note" role="alert">{error}</p>}
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
