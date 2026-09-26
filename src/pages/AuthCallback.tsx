import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getSession } from "../lib/api/auth";

// Google reports a refusal by redirecting BACK with an error on the URL rather than
// by failing the request, so without somewhere to read it the person lands on a
// sign-in form with no idea why they are there. That is the whole reason this route
// exists, and it is why it sits outside RequireAuth in routes.tsx.
//
// The client is created with default options, so this is the implicit flow and the
// error arrives in the HASH. Both are read anyway: the query is where it would land
// if the flow were ever switched to PKCE, and guessing wrong here costs an
// unexplained blank screen.
function errorFromUrl(): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  for (const p of [hash, query]) {
    const described = p.get("error_description") ?? p.get("error");
    if (described) return described.replace(/\+/g, " ");
  }
  return null;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = errorFromUrl();
    if (fromUrl) {
      setError(fromUrl);
      return;
    }
    // getSession resolves only after supabase-js has taken the session out of the
    // URL, so by here the exchange has either happened or genuinely failed.
    getSession()
      .then((session) => {
        if (session) navigate("/", { replace: true });
        else setError("That sign-in did not complete. Please try again.");
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="plate auth-card">
        <h1>Could not sign you in</h1>
        <p role="alert">{error}</p>
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="plate auth-card">
      <h1>Signing you in</h1>
      <p role="status">One moment.</p>
    </div>
  );
}
