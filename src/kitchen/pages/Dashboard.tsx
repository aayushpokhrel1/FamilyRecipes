import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { myOrgs } from "../../lib/api/kitchen/orgs";
import { myGroupNumbers } from "../../lib/api/kitchen/numbers";
import type { Org, StripNumbers } from "../../lib/api/kitchen/types";

// The strip is a sentence, not three numbers, for the same reason the numbers page is: "1 of
// 4" answers a question and "1" does not.
function stripWords(strip: StripNumbers): string {
  if (strip.started === 0) return "No dishes yet.";
  const landed = `${strip.landed} of ${strip.started === 1 ? "1 dish" : `${strip.started} dishes`} signed off`;
  if (strip.median_days === null) return `${landed}.`;
  return `${landed}, median ${strip.median_days} ${strip.median_days === 1 ? "day" : "days"}.`;
}

export default function Dashboard() {
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [numbers, setNumbers] = useState<Record<string, StripNumbers>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    myOrgs()
      .then(setOrgs)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
    // The links are the function and the figures are decoration, the same rule OrgLayout
    // states about the group's name: a failed or slow numbers call must never cost the
    // navigation, so it falls back to no strip rather than to the error state.
    myGroupNumbers()
      .then(setNumbers)
      .catch(() => setNumbers({}));
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
              {/* Absent for a group the caller does not run, which is the database saying
                  they are not served its numbers. Nothing is rendered rather than a zero. */}
              {numbers[org.id] && <p>{stripWords(numbers[org.id])}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
