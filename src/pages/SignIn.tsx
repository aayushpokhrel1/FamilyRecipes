import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { signIn, requestPasswordReset } from "../lib/api/auth";
import { reportError } from "../lib/api/errorLog";
import GoogleButton from "../components/GoogleButton";
import AuthMark from "../components/AuthMark";
import { safeNext, withNext } from "../lib/nextPath";

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Where RequireAuth or an invite page was taking them before it sent them here. In the
  // URL, not in router state: see lib/nextPath.ts for why that distinction is the whole bug.
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signIn(email, password);
      navigate(next ?? "/");
    } catch (err) {
      reportError("auth:sign-in", err);
      setError(err instanceof Error ? err.message : String(err));
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
      reportError("auth:password-reset", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <AuthMark />
      <h1>Sign in</h1>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      {/* NOT required, unlike the email: "Forgot password?" is a submit-less button in this
          same form, and a required password would make the browser refuse to run it. */}
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
      <button type="button" onClick={handleForgotPassword}>Forgot password?</button>
      {resetSent && (
        <p role="status">If that address has an account, a reset link is on its way.</p>
      )}
      <GoogleButton label="Sign in with Google" />
      <p>
        Need an account? <Link to={withNext("/signup", next)}>Sign up</Link>
      </p>
      {/* A plain <a>, NOT a <Link>, because the explanation lives on the other host: a
          router link would resolve it as a route inside this app. Every guarded route sends
          a signed-out visitor here, so someone arriving from a shared recipe link lands on
          this form knowing nothing about the product, and this was a dead end for them. */}
      <p>
        <a href="https://enamelvault.com/">What is this?</a>
      </p>
    </form>
  );
}
