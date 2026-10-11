import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getSession } from "../../lib/api/auth";
import { safeNext } from "../../lib/nextPath";

// The page an email confirmation link and a Google round trip both land on. It exists to WAIT
// for supabase-js to take the session out of the URL before navigating: going straight to the
// destination races that, and the destination then bounces to /signin.
export default function AuthCallback() {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const next = safeNext(params.get("next")) ?? "/";
    getSession()
      .then((session) => {
        if (session) navigate(next, { replace: true });
        else setError("That link has expired. Sign in and the invite will still work.");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong."));
  }, [navigate, params]);

  return (
    <div className="prose plate">
      <h1>Signing you in</h1>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
