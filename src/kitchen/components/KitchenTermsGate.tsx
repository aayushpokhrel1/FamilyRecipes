import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { acceptKitchenTerms, getMyAcceptance } from "../../lib/api/kitchen/terms";

// BUMP THIS WHENEVER THE WORDING IN pages/Terms.tsx CHANGES. The gate compares it against the
// accepted version, so an edit shipped without a bump means nobody is re-asked and the stored
// row claims people accepted text they never saw.
//
// KitchenTermsGate.version.test.ts holds this mechanically: it hashes the page and fails if the
// wording moved without this constant moving with it. When it fails, bump BOTH this and
// KITCHEN_TERMS_UPDATED in lib/legal.ts, then paste the new hash the failure prints.
export const KITCHEN_TERMS_VERSION = "2026-10-21";

// A SEPARATE gate from the family app's, not a copy of it for its own sake: src/kitchen may
// not import lib/api/profile.ts (supabase/kitchen_seal.test.ts), so it cannot reach the
// family's acceptance record even if the components were identical.
//
// WHY THIS EXISTS AT ALL: plans 1 to 3 shipped this product with every route behind
// RequireAuth and NONE behind any terms gate, so nobody using the kitchen app had accepted
// anything. src/routes.terms.test.ts reads the FAMILY routes file, so the whole suite was green
// over an entirely ungated product. routes.terms.test.tsx in this app now reads this one.
//
// The gate sits AFTER authentication rather than on the signup form, for the same reason the
// family one does: a signup checkbox would miss Google sign-in, which never touches that form,
// and would miss every account that already exists.
export default function KitchenTermsGate({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [accepted, setAccepted] = useState(false);
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyAcceptance()
      .then((acceptance) => {
        if (!alive) return;
        setReturning(acceptance !== null);
        setAccepted(acceptance !== null && acceptance.version === KITCHEN_TERMS_VERSION);
      })
      // A FAILED READ MUST NOT BE A LOCKED DOOR, and on this host that is not hypothetical:
      // until the hosted project exposes the `kitchen` schema by hand at Settings -> API ->
      // Exposed schemas, every kitchen call errors. Refusing entry then would lock out an
      // entire group over a setting, so the failure mode is openness, exactly as the family
      // gate decided for a failing profile read.
      .catch(() => {
        if (!alive) return;
        setAccepted(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return null;
  if (accepted) return <>{children}</>;

  async function onAccept() {
    setBusy(true);
    try {
      // The version RENDERED above, not "a version". Passing anything else makes the stored
      // row evidence of text this person never saw, which is the only thing that row is for.
      await acceptKitchenTerms(KITCHEN_TERMS_VERSION);
      setAccepted(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose plate">
      <h1>Before your group starts using this</h1>
      <p>
        {returning
          ? "The terms for kitchens have been updated since you last agreed to them. Please read them again."
          : "Please read the terms and the privacy page before you put your kitchen's dishes in here."}
      </p>
      <p>
        The two worth reading properly are what a sign-off does and does not mean, and what your
        colleagues can see about you.
      </p>
      <p>
        <Link to="/terms">Read the terms</Link> and the{" "}
        <Link to="/privacy">privacy page</Link>.
      </p>
      <button type="button" onClick={onAccept} disabled={busy}>
        Accept and continue
      </button>
    </div>
  );
}
