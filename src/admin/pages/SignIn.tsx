import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signIn } from "../../lib/api/auth";
import { reportError } from "../../lib/api/errorLog";
import GoogleButton from "../../components/GoogleButton";
import AuthMark from "../../components/AuthMark";
import { FAMILY_ORIGIN } from "../../lib/hosts";
import { safeNext } from "../../lib/nextPath";

// THE CONSOLE'S OWN DOOR, and the reason it exists is a seam rather than a bug.
//
// Until this page landed, a signed-out visitor here was bounced to the FAMILY app's sign-in
// carrying a return URL, and came back through the shared cookie. That worked, and it meant
// the moderation console could not let anyone in without another product's page staying up,
// staying at that path, and keeping a cross-origin redirect door open for it. One app per
// door; this host is now self-sufficient.
//
// Deliberately shaped like the other two apps' sign-in pages, for their reason: a person who
// holds one account should not have to learn three different doors.
//
// NO SIGN-UP LINK AND NO FORGOT-PASSWORD BUTTON, both on purpose:
//
//   - Nobody creates an account here. Moderators are promoted by the owner from an account
//     that already exists on the family app, so a sign-up form on this host would only offer
//     a stranger a way to make an account that can see nothing.
//   - requestPasswordReset sends the recovery link to `${window.location.origin}/recover`,
//     and there is no /recover route on this host. Offering the button would mail a link to a
//     page that does not exist, which is worse than not offering it. The family app has the
//     route, so the link below is the honest answer.
export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // From the URL and through safeNext, never from router state: Google leaves this page
  // entirely and comes back through /auth/callback. safeNext is a trust boundary, not a
  // tidy-up, and without it this page is an open redirector. See lib/nextPath.ts.
  const next = safeNext(params.get("next")) ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      reportError("auth:sign-in", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <AuthMark label="Enamel Vault console" />
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
      <label htmlFor="password">
        Password
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      <GoogleButton label="Sign in with Google" />
      {/* Plain anchors, NOT Links: both destinations live on another host, and a router link
          would resolve them as routes inside this app. */}
      <p>
        Forgotten your password? <a href={`${FAMILY_ORIGIN}/signin`}>Reset it on Enamel Vault</a>,
        then come back.
      </p>
    </form>
  );
}
