import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { addSite, listSites } from "../../lib/api/kitchen/orgs";
import type { Site } from "../../lib/api/kitchen/types";

export default function Sites() {
  const { id = "" } = useParams();
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="prose plate">
      <h1>Your sites</h1>
      {sites.length === 0 ? (
        <p>No sites yet. A site is one kitchen: the place a dish is actually cooked.</p>
      ) : (
        <ul>
          {sites.map((site) => (
            <li key={site.id}>{site.name}</li>
          ))}
        </ul>
      )}
      <form onSubmit={add}>
        <label htmlFor="site-name">Add a site</label>
        <input id="site-name" value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Add the site
        </button>
      </form>
      <p>
        <Link to={`/orgs/${id}/staff`}>Invite your staff</Link>
      </p>
    </div>
  );
}
