import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile, getPublicCooks } from "../lib/api/profile";
import { listOpenReports, resolveReport } from "../lib/api/moderation";
import { listOpenAppeals, resolveAppeal } from "../lib/api/appeals";
import {
  deleteUserAccount,
  getAdminStats,
  listAdminUsers,
  setModerator,
  suspendUser,
  unsuspendUser,
  type AdminStats,
  type AdminUser,
} from "../lib/api/admin";
import { REASON_LABELS, type AppealRow, type PublicCook, type ReportRow } from "../lib/api/types";
import Skeleton from "../components/Skeleton";

type View = "reports" | "appeals" | "overview" | "people";

// A short date for the roster. A timestamptz is a real instant, so toLocaleDateString is
// right here, and a null last sign-in is a real answer (never signed in) rather than a
// missing one, so it renders as a dash instead of an empty cell.
function shortDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

// The last 30 days as "YYYY-MM-DD", oldest first, gaps filled with zero. Built from local
// date parts rather than toISOString(): that converts to UTC, so local midnight in any UTC+
// timezone reports the previous day and the whole row shifts by one.
function lastThirtyDays(byDay: Record<string, number>): { day: string; count: number }[] {
  const out: { day: string; count: number }[] = [];
  const d = new Date();
  d.setDate(d.getDate() - 29);
  for (let i = 0; i < 30; i++) {
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    out.push({ day, count: byDay[day] ?? 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function Moderation() {
  const [profile, setProfile] = useState<{ is_moderator: boolean } | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cooks, setCooks] = useState<Map<string, PublicCook>>(new Map());
  const [view, setView] = useState<View>("reports");

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

      {/* Four views, not four routes: the console is one page, and a URL per tab would be
          four more router entries for no navigational gain. */}
      <div className="group-toggle">
        <button type="button" aria-pressed={view === "reports"} onClick={() => setView("reports")}>
          Reports
        </button>
        <button type="button" aria-pressed={view === "appeals"} onClick={() => setView("appeals")}>
          Appeals
        </button>
        <button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")}>
          Overview
        </button>
        <button type="button" aria-pressed={view === "people"} onClick={() => setView("people")}>
          People
        </button>
      </div>

      {view === "reports" && (
        <>
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
        </>
      )}

      {/* Mounted only once the moderator switches to it, so the roster's service-role call
          never runs on the page's main job, which is the report queue. */}
      {view === "appeals" && <Appeals />}
      {view === "overview" && <Overview />}
      {view === "people" && <People />}
    </div>
  );
}

// What an appeal is against, in words rather than the raw enum. ONE place, because the same
// mapping read inline in three JSX branches is three copies that drift.
const SUBJECT_LABELS: Record<AppealRow["subject_type"], string> = {
  name: "A cleared public name",
  suspension: "A suspension",
  recipe: "A removed recipe",
};

function Appeals() {
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const [cooks, setCooks] = useState<Map<string, PublicCook>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which row is mid-action, so its buttons can be disabled and its error shown beside it.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The note PER ROW, keyed by appeal id. One shared string would show every row the same
  // text and, worse, send whatever was typed anywhere as the note on whichever appeal was
  // resolved: a note written for one cook arriving on another cook's decision.
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let ignore = false;
    listOpenAppeals()
      .then(async (rows) => {
        if (ignore) return;
        setAppeals(rows);
        // ONE call for every appellant in the queue, never one per row. public_cooks is a
        // security definer view, which is the only reason a moderator can read these names
        // at all: profiles itself is readable only to its owner.
        const found = await getPublicCooks(rows.map((r) => r.cook_id)).catch(
          () => new Map<string, PublicCook>(),
        );
        if (!ignore) setCooks(found);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ignore) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function resolve(a: AppealRow, outcome: "granted" | "declined") {
    setBusyId(a.id);
    setRowError(null);
    try {
      // Granting is what performs the undo, and the database does that inside
      // resolve_appeal, so this component never touches profiles or recipes itself.
      await resolveAppeal(a.id, outcome, notes[a.id] ?? "");
      // Drop the row locally rather than refetching: the only thing that changed is this
      // one appeal's resolution, and a refetch would also throw away the moderator's place.
      setAppeals((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      // The row stays: a failed resolve must not read as a resolved one.
      setRowError({ id: a.id, message: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <Skeleton shape="plate" count={3} />;
  // A failed load shows its own message and nothing else, so it can never blank the page.
  if (error) return <p className="form-error">{error}</p>;
  if (appeals.length === 0) return <p className="vault-note">No open appeals.</p>;

  return (
    <ul className="report-list">
      {appeals.map((a) => (
        <li key={a.id} className="plate panel">
          {cooks.get(a.cook_id)?.handle ? (
            // A cook who has cleared their handle has no public page, so there is nothing to
            // link to: a link to /cooks/undefined is worse than plain text.
            <Link to={"/cooks/" + cooks.get(a.cook_id)!.handle}>
              {cooks.get(a.cook_id)!.public_name ?? cooks.get(a.cook_id)!.handle}
            </Link>
          ) : (
            <span>Unknown cook</span>
          )}
          <p className="vault-note">
            {SUBJECT_LABELS[a.subject_type]}
            {a.subject_type === "recipe" && a.subject_id && (
              <>
                {": "}
                <Link to={"/recipes/" + a.subject_id}>{a.recipes?.title ?? "Untitled"}</Link>
              </>
            )}
          </p>
          <p>{a.body}</p>
          <div className="recipe-actions">
            <input
              aria-label={"Note for " + (cooks.get(a.cook_id)?.public_name
                ?? cooks.get(a.cook_id)?.handle ?? "this cook")}
              placeholder="Note (optional)"
              value={notes[a.id] ?? ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
            />
            <button type="button" disabled={busyId === a.id} onClick={() => resolve(a, "granted")}>
              Grant
            </button>
            <button type="button" disabled={busyId === a.id} onClick={() => resolve(a, "declined")}>
              Decline
            </button>
          </div>
          {/* The backend's refusal text is the useful part, so it is shown verbatim beside
              the row rather than swallowed. */}
          {rowError?.id === a.id && <p className="form-error">{rowError.message}</p>}
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    getAdminStats()
      .then((s) => { if (!ignore) setStats(s); })
      .catch((e: Error) => { if (!ignore) setError(e.message); });
    return () => {
      ignore = true;
    };
  }, []);

  // A failed load shows its own message and nothing else, so it can never blank the page
  // or take the other two sections down with it.
  if (error) return <p className="form-error">{error}</p>;
  if (!stats) return <Skeleton shape="plate" count={2} />;

  const days = lastThirtyDays(stats.signupsByDay);
  const total = days.reduce((sum, d) => sum + d.count, 0);
  // The busiest day is the scale, so the tallest bar is always full height. A zero busiest
  // day would divide by zero, so it falls back to 1 and every bar renders flat.
  const busiest = Math.max(1, ...days.map((d) => d.count));

  const tiles: [string, number][] = [
    ["Users", stats.users],
    ["Recipes", stats.recipes],
    ["Published", stats.published],
    ["Removed", stats.removed],
    ["Families", stats.families],
    ["Open reports", stats.openReports],
    ["Suspended", stats.suspended],
  ];

  return (
    <>
      <ul className="stat-row">
        {tiles.map(([label, value]) => (
          <li key={label} className="plate stat-tile">
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </li>
        ))}
      </ul>

      <section className="plate panel">
        <h2>Signups, last 30 days</h2>
        {/* role="img" with a summary label: a wall of unlabelled divs says nothing to a
            screen reader, and the individual bars are decoration for the total. */}
        <div
          className="signup-bars"
          role="img"
          aria-label={`${total} signups in the last 30 days`}
        >
          {days.map((d) => (
            <div
              key={d.day}
              className="signup-bar"
              title={`${d.day}: ${d.count}`}
              style={{ height: `${Math.round((d.count / busiest) * 100)}%` }}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function People() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  // 1-based, because the admin function's `users` action is: it clamps anything below 1
  // to page 1. Starting at 0 made the first Load more re-request page 1 and append a
  // duplicate of everyone already on screen.
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  // Which row is mid-action, so its buttons can be disabled and its error shown beside it.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  // The row whose inline suspend form is open, and the reason typed into it.
  const [suspendId, setSuspendId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // The row whose delete confirmation is open, and the word typed to arm it.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmWord, setConfirmWord] = useState("");

  // Refetch from the server rather than patching the row locally: the roster is a
  // service-role view of the database, and a local patch would show a state the database
  // does not hold (a suspension that failed, a moderator flag that was refused).
  async function refresh() {
    const first = await listAdminUsers(1);
    setUsers(first.users);
    setHasMore(first.hasMore);
    setPage(1);
  }

  useEffect(() => {
    let ignore = false;
    listAdminUsers(1)
      .then((r) => {
        if (ignore) return;
        setUsers(r.users);
        setHasMore(r.hasMore);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (ignore) return;
        setError(e.message);
        setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function loadMore() {
    const next = page + 1;
    const r = await listAdminUsers(next);
    setUsers((prev) => [...prev, ...r.users]);
    setHasMore(r.hasMore);
    setPage(next);
  }

  // Every action funnels through here so the busy flag, the error placement and the
  // refresh-on-success rule are written once. On failure the roster is left untouched.
  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setRowError(null);
    try {
      await fn();
      await refresh();
      setSuspendId(null);
      setDeleteId(null);
      setReason("");
      setConfirmWord("");
    } catch (e) {
      setRowError({ id, message: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? users.filter((u) =>
        [u.displayName, u.handle, u.email].some((v) => v?.toLowerCase().includes(needle)),
      )
    : users;

  if (loading) return <Skeleton shape="plate" count={3} />;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      <div className="vault-tools">
        {/* aria-label, not a placeholder: a placeholder is not a label, and the filter is
            the only control above the table. */}
        <input
          type="search"
          aria-label="Filter people by name, handle or email"
          placeholder="Filter by name, handle or email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Person</th>
            <th scope="col">Email</th>
            <th scope="col">Joined</th>
            <th scope="col">Last seen</th>
            <th scope="col">Recipes</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((u) => (
            <tr key={u.id}>
              <td>
                {u.displayName ?? "Unnamed"}
                {u.handle && (
                  <>
                    {" "}
                    <Link to={"/cooks/" + u.handle}>@{u.handle}</Link>
                  </>
                )}
              </td>
              <td>
                {u.email ?? "-"}
                {!u.emailConfirmed && " unconfirmed"}
                {u.provider && u.provider !== "email" && " (" + u.provider + ")"}
              </td>
              <td>{shortDate(u.createdAt)}</td>
              <td>{shortDate(u.lastSignInAt)}</td>
              <td>{u.recipes}</td>
              <td>
                {u.suspendedAt
                  ? "Suspended" + (u.suspendedReason ? ": " + u.suspendedReason : "")
                  : u.isModerator
                    ? "Moderator"
                    : "Active"}
              </td>
              <td>
                <div className="recipe-actions">
                  {u.suspendedAt ? (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => run(u.id, () => unsuspendUser(u.id))}
                    >
                      Unsuspend
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === u.id}
                      onClick={() => {
                        setSuspendId(suspendId === u.id ? null : u.id);
                        setReason("");
                        setRowError(null);
                      }}
                    >
                      Suspend
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => run(u.id, () => setModerator(u.id, !u.isModerator))}
                  >
                    {u.isModerator ? "Remove moderator" : "Make moderator"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === u.id}
                    onClick={() => {
                      setDeleteId(deleteId === u.id ? null : u.id);
                      setConfirmWord("");
                      setRowError(null);
                    }}
                  >
                    Delete
                  </button>
                </div>

                {/* A typed reason, not window.prompt: the backend rejects an empty one and
                    the reason is shown to the person, so it has to be a real field. */}
                {suspendId === u.id && (
                  <form
                    className="inline-confirm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(u.id, () => suspendUser(u.id, reason.trim()));
                    }}
                  >
                    <label>
                      Reason for suspending {u.displayName ?? u.email ?? "this person"}
                      <input value={reason} onChange={(e) => setReason(e.target.value)} />
                    </label>
                    <button
                      type="submit"
                      className="action"
                      disabled={!reason.trim() || busyId === u.id}
                    >
                      Confirm suspend
                    </button>
                  </form>
                )}

                {/* Delete is irreversible, so the confirming button stays disabled until the
                    word is typed. The typed word is the deliberate act, not the click. */}
                {deleteId === u.id && (
                  <form
                    className="inline-confirm"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(u.id, () => deleteUserAccount(u.id));
                    }}
                  >
                    <label>
                      Type DELETE to confirm deleting {u.displayName ?? u.email ?? "this person"}
                      <input
                        value={confirmWord}
                        onChange={(e) => setConfirmWord(e.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="action"
                      disabled={confirmWord !== "DELETE" || busyId === u.id}
                    >
                      Confirm delete
                    </button>
                  </form>
                )}

                {/* The backend's refusal text is the useful part (it names the reason), so it
                    is shown verbatim beside the row rather than swallowed. */}
                {rowError?.id === u.id && <p className="form-error">{rowError.message}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown.length === 0 && <p className="vault-note">Nobody matches that filter.</p>}

      {hasMore && (
        <button type="button" className="action" onClick={loadMore}>
          Load more
        </button>
      )}
    </>
  );
}
