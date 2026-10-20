import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addSite, closeSite, listSites, reopenSite, siteClosureImpact } from "../../lib/api/kitchen/orgs";
import type { Site } from "../../lib/api/kitchen/types";
import { useMyRole } from "../lib/useMyRole";

// The warning has to read like a sentence a person would write, because the numbers are the
// damage: "0 dishes and 0 people" is a confirmation that says nothing.
function dishesWords(n: number): string {
  if (n === 0) return "no dishes on trial";
  return n === 1 ? "1 dish on trial" : `${n} dishes on trial`;
}

function peopleWords(n: number): string {
  if (n === 0) return "nobody";
  return n === 1 ? "1 person" : `${n} people`;
}

export default function Sites() {
  const { id = "" } = useParams();
  const { role } = useMyRole(id);
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The site whose warning is showing, and what closing it would cost. Both are set only by
  // the click that asks to close, never seeded from the fetched list.
  const [closing, setClosing] = useState<{ siteId: string; dishes: number; people: number } | null>(
    null,
  );

  useEffect(() => {
    listSites(id)
      .then(setSites)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, [id]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the site a name.");
    setBusy(true);
    try {
      await addSite(id, name.trim());
      setName("");
      // Re-read rather than pushing the new row onto the list: the server decides the id and
      // the order, and a locally invented row drifts from it.
      setSites(await listSites(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // Asking to close reads the cost first and shows it. Nothing moves until the person
  // confirms, because the counts ARE the damage and a confirmation that does not name them
  // is decoration.
  async function askToClose(siteId: string) {
    setError(null);
    setBusy(true);
    try {
      const impact = await siteClosureImpact(siteId);
      setClosing({ siteId, ...impact });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function close(siteId: string) {
    setError(null);
    setBusy(true);
    try {
      await closeSite(siteId);
      setClosing(null);
      setSites(await listSites(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen(siteId: string) {
    setError(null);
    setBusy(true);
    try {
      await reopenSite(siteId);
      setSites(await listSites(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose plate">
      <h1>Your sites</h1>
      {sites.length === 0 ? (
        <p>No sites yet. A site is one kitchen: the place a dish is actually cooked.</p>
      ) : (
        <ul>
          {sites.map((site) => (
            <li key={site.id}>
              {site.name}
              {site.closed_at !== null && " — Closed"}
              {/* `close_site` and `reopen_site` are the owner's alone and refuse everybody
                  else, so the controls are the owner's too: a page must not render a control
                  its viewer's policy will refuse. A closed site offers no second Close. */}
              {role === "owner" &&
                (site.closed_at !== null ? (
                  <>
                    {" "}
                    <button type="button" disabled={busy} onClick={() => reopen(site.id)}>
                      Reopen
                    </button>{" "}
                    <span>
                      Reopening does not bring back the dishes or the people that closing moved.
                    </span>
                  </>
                ) : closing?.siteId === site.id ? (
                  <>
                    {" "}
                    <span>
                      Closing this site sends {dishesWords(closing.dishes)} back to development
                      and takes {peopleWords(closing.people)} off it. Chefs and owners are not
                      touched.
                    </span>{" "}
                    <button type="button" disabled={busy} onClick={() => close(site.id)}>
                      Close the site
                    </button>{" "}
                    <button type="button" disabled={busy} onClick={() => setClosing(null)}>
                      Leave it open
                    </button>
                  </>
                ) : (
                  <>
                    {" "}
                    <button type="button" disabled={busy} onClick={() => askToClose(site.id)}>
                      Close
                    </button>
                  </>
                ))}
            </li>
          ))}
        </ul>
      )}
      {/* `add_site` is the owner's alone and answers KIT01 to anybody else, so the form is
          the owner's too. The project rule is that a page must not render a control its
          viewer's policy will refuse: this one refuses LOUDLY, which is why it read as
          harmless and sat here through three plans, but a button that always fails is still a
          lie about what the viewer may do. The staff page next door got this right. */}
      {role === "owner" && (
        <form onSubmit={add}>
          <label htmlFor="site-name">Add a site</label>
          <input id="site-name" value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" disabled={busy}>
            Add the site
          </button>
        </form>
      )}
      {/* Outside the form now: a load error has to reach a cook too, and it used to be
          rendered inside the part only an owner sees. */}
      {error && <p role="alert">{error}</p>}
      <p>
        <Link to={`/orgs/${id}/staff`}>Invite your staff</Link>
      </p>
    </div>
  );
}
