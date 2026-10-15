import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { signIn, requestPasswordReset } from "../../lib/api/auth";
import GoogleButton from "../../components/GoogleButton";
import AuthMark from "../../components/AuthMark";
import { safeNext, withNext } from "../../lib/nextPath";

// Deliberately shaped like the family app's src/pages/SignIn.tsx, because a person who holds
// accounts on both should not have to learn two different doors.
//
// It does NOT use reportError, and that is the one difference that is load-bearing rather
// than cosmetic: reportError lives in lib/api/errorLog.ts, which supabase/kitchen_seal.test.ts
// forbids the kitchen app from importing. AuthMark and GoogleButton are fine because the
// first imports nothing at all and the second reaches only lib/api/auth, which the seal
// allows on the grounds that one login serves both products.
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // From the URL and through safeNext, never from router state. safeNext is a trust boundary:
  // the parameter is attacker-controlled, and without it this page is an open redirector.
  const next = safeNext(params.get("next")) ?? "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResetSent(false);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // Deliberately outside the submit path: asking for a reset must not try to sign in.
  async function handleForgotPassword() {
    setError(null);
    setResetSent(false);
    if (!email.trim()) {
      setError("Enter your email address first.");
      return;
    }
    try {
      await requestPasswordReset(email);
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  return (
    <form onSubmit={submit} className="plate auth-card">
      <AuthMark label="Enamel Vault for kitchens" />
      <h1>Sign in</h1>
      <label htmlFor="email">
        Email
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      {/* NOT required, unlike the email: "Forgot password?" is a submit-less button in this
          same form, and a required password would make the browser refuse to run it. */}
      <label htmlFor="password">
        Password
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      <button type="button" onClick={handleForgotPassword}>
        Forgot password?
      </button>
      {resetSent && (
        <p role="status">If that address has an account, a reset link is on its way.</p>
      )}
      <GoogleButton label="Sign in with Google" />
      {/* The destination has to survive this hop too, or an invite dies on the way to sign-up. */}
      <p>
        No account yet? <Link to={withNext("/signup", params.get("next"))}>Create one</Link>.
      </p>
      {/* A plain <a>, NOT a <Link>, because the explanation lives on another host entirely: a
          router link would resolve it as a route inside this app. */}
      <p>
        <a href="https://enamelvault.com/">What is this?</a>
      </p>
    </form>
  );
}
