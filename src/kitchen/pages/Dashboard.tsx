import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { myOrgs } from "../../lib/api/kitchen/orgs";
import type { Org } from "../../lib/api/kitchen/types";

export default function Dashboard() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    myOrgs()
      .then(setOrgs)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, []);

  if (error) {
    return (
      <div className="prose plate">
        <h1>Your kitchens</h1>
        {/* The error is SHOWN, not logged. The likeliest one here is the hosted project not
            exposing the kitchen schema, and a blank page would send the next person reading
            this code instead of reading docs/OPERATIONS.md. */}
        <p role="alert">{error}</p>
      </div>
    );
  }
  if (!orgs) return <div className="prose plate">Loading.</div>;

  return (
    <div className="prose plate">
      <h1>Your kitchens</h1>
      {orgs.length === 0 ? (
        <>
          <p>You are not part of a kitchen group yet.</p>
          <Link to="/orgs/new">Start a kitchen group</Link>
        </>
      ) : (
        <ul>
          {orgs.map((org) => (
            <li key={org.id}>
              {org.name} <Link to={`/orgs/${org.id}/sites`}>Sites</Link>{" "}
              <Link to={`/orgs/${org.id}/staff`}>Staff</Link>{" "}
              <Link to={`/orgs/${org.id}/dishes`}>Dishes</Link>{" "}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
