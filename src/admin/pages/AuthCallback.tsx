import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { getSession } from "../../lib/api/auth";
import { safeNext } from "../../lib/nextPath";
import AuthMark from "../../components/AuthMark";

// Where a Google round trip from this host lands. It exists to WAIT for supabase-js to take
// the session out of the URL before navigating: going straight to the destination races that,
// and the destination then bounces back to /signin.
//
// Supabase's redirect allow list needs `https://admin.enamelvault.com/auth/callback**`, WITH
// the globstar. Without it the hosted service silently substitutes the Site URL and this route
// never runs; docs/OPERATIONS.md has the measurement.
//
// It does not parse Google's own refusal off the URL the way src/pages/AuthCallback.tsx does.
// That page serves strangers who need to be told why; this one serves an operator who can read
// the link below and try again, and a third copy of that parser is worth less than it costs.
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = safeNext(params.get("next")) ?? "/";
    getSession()
      .then((session) => {
        if (session) navigate(next, { replace: true });
        else setError("That sign-in did not complete. Please try again.");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [navigate, params]);

  return (
    <div className="plate auth-card">
      <AuthMark label="Enamel Vault console" />
      <h1>{error ? "Could not sign you in" : "Signing you in"}</h1>
      {error ? <p role="alert">{error}</p> : <p role="status">One moment.</p>}
      {error && (
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      )}
    </div>
  );
}
