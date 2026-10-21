import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { groupNumbers } from "../../lib/api/kitchen/numbers";
import type { GroupNumbers } from "../../lib/api/kitchen/types";

// The figures are read as sentences rather than as bare numbers, because "1 of 4" answers a
// question and "1" does not. The plural is spelled out for the same reason.
function dishesWords(n: number): string {
  return n === 1 ? "1 dish" : `${n} dishes`;
}

function daysWords(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

export default function Numbers() {
  const { id = "" } = useParams();
  // `undefined` is still loading and `null` is "not served this", so the two cannot be
  // confused: a group with nothing in it arrives as a full object with zeroes.
  const [numbers, setNumbers] = useState<GroupNumbers | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Both pieces of state are cleared BEFORE the new call, and the result is dropped if the
    // group changed while it was in flight. Without this, moving from one group to another
    // shows the previous group's figures, or worse its "not served" note, for as long as the
    // fetch takes: on this page that note is a claim about the viewer's role, so a stale one
    // tells an owner they are not the owner.
    let live = true;
    setNumbers(undefined);
    setError(null);
    groupNumbers(id)
      .then((n) => {
        if (live) setNumbers(n);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Could not load.");
      });
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="prose plate">
      <h1>Numbers</h1>
      {error && <p role="alert">{error}</p>}
      {/* A failed read is terminal, so the loading line below must not also render: a page
          that says it failed AND that it is still loading has told the reader nothing. */}
      {error ? null : numbers === null ? (
        // Not an error and not an empty page: the database answered, and the answer was that
        // this viewer is not served the group's numbers.
        <p>Only an owner or a chef sees a group's numbers.</p>
      ) : numbers === undefined ? (
        <p>Loading.</p>
      ) : numbers.funnel.dishes === 0 ? (
        // Three zeroes would read as a measurement that came out at nothing. There is nothing
        // to measure yet, which is a different statement.
        <p>This group has not started a dish yet, so there is nothing to measure.</p>
      ) : (
        <>
          <h2>Does a dish land</h2>
          <p>
            {numbers.dishes.landed} of {dishesWords(numbers.dishes.started)} signed off.
          </p>
          <p>
            {numbers.dishes.median_days === null
              ? "Nothing has been signed off yet, so there is no median to give."
              : `The median dish takes ${daysWords(numbers.dishes.median_days)} from first version to sign-off.`}
          </p>
          <p>
            {numbers.dishes.slow.length === 0
              ? "No dish has been in development for over a month."
              : `${dishesWords(numbers.dishes.slow.length)} in development for over a month.`}
          </p>
          {numbers.dishes.slow.length > 0 && (
            <ul>
              {numbers.dishes.slow.map((dish) => (
                <li key={dish.id}>
                  <Link to={`/orgs/${id}/dishes/${dish.id}`}>{dish.title}</Link>{" "}
                  <span>{daysWords(dish.days)}</span>
                </li>
              ))}
            </ul>
          )}

          <h2>Where it stalls</h2>
          <p>
            {`${numbers.funnel.dishes} dishes created, ${numbers.funnel.with_version} with a version, ` +
              `${numbers.funnel.trialled} trialled, ${numbers.funnel.landed} signed off, ` +
              `${numbers.funnel.on_menu} on a menu.`}
          </p>

          <h2>Which sites are real</h2>
          {numbers.sites.length === 0 ? (
            <p>This group has no sites yet.</p>
          ) : (
            <ul>
              {numbers.sites.map((site) => (
                <li key={site.id}>
                  {site.name}: {site.substitutions} substitutions, {site.trials} on trial.{" "}
                  {site.last_recorded === null
                    ? `Nothing recorded since it was added on ${new Date(site.added).toLocaleDateString()}.`
                    : `Last recorded on ${new Date(site.last_recorded).toLocaleDateString()}.`}
                  {site.closed && " Closed."}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
