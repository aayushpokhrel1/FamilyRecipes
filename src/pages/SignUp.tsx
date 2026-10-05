import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signUp } from "../lib/api/auth";
import { reportError } from "../lib/api/errorLog";
import GoogleButton from "../components/GoogleButton";

export default function SignUp() {
  const navigate = useNavigate();
  const location = useLocation();
  // Where RequireAuth was taking them before it sent them here. An invite link is the case
  // this exists for: without it, signing in drops you on the home page and the invite is
  // gone.
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname;
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const { session } = await signUp(email, password, displayName);
      if (session) navigate(from ?? "/");
      else setSent(true);
    } catch (err) {
      reportError("auth:sign-up", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (sent) {
    return (
      <div className="plate auth-card">
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{email}</strong>. Click it to finish setting up
          your account.
        </p>
        {/* Deliberately does NOT say "then sign in": Supabase's confirmation link verifies and
            redirects with a session, so the usual landing is already signed in. Telling someone
            to do a thing that has already happened reads as a broken flow. */}
        <p>
          <Link to="/signin">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <h1>Sign up</h1>
      {/* autoComplete is what lets a password manager fill and SAVE these; without
          new-password a manager offers the existing password instead of generating one.
          required lets the browser block an empty submit before any network call. */}
      <label>
        Display name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          autoComplete="name"
          required
        />
      </label>
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
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          minLength={8}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {/* The consent notice, and it is a NOTICE rather than a tick box on purpose. The real
          agreement is TermsGate, which sits after authentication and therefore also catches
          Google sign-up and every account that already existed; a box here would catch neither.
          What this has to do is make the documents READABLE BEFORE you hand over an email
          address, which is why both links are here and why both pages are public. */}
      <p className="form-consent">
        By signing up you agree to our <Link to="/terms">terms</Link> and to the{" "}
        <Link to="/privacy">privacy policy</Link>, which explains what is stored and how to get
        it deleted. No marketing email is ever sent, and your address is not shared.
      </p>
      <button type="submit">Create account</button>
      <GoogleButton label="Sign up with Google" />
      <p>
        Already have an account? <Link to="/signin" state={location.state}>Sign in</Link>
      </p>
    </form>
  );
}
