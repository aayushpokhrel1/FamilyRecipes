import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "../lib/api/auth";

export default function SignUp() {
  const navigate = useNavigate();
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
      if (session) navigate("/");
      else setSent(true);
    } catch (err) {
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
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign up</button>
      <p>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </form>
  );
}
