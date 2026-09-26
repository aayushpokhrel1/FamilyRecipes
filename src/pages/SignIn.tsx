import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signIn, requestPasswordReset } from "../lib/api/auth";
import GoogleButton from "../components/GoogleButton";

export default function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await signIn(email, password);
      navigate("/");
    } catch (err) {
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
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <h1>Sign in</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button>
      <button type="button" onClick={handleForgotPassword}>Forgot password?</button>
      {resetSent && (
        <p role="status">If that address has an account, a reset link is on its way.</p>
      )}
      <GoogleButton label="Sign in with Google" />
      <p>
        Need an account? <Link to="/signup">Sign up</Link>
      </p>
    </form>
  );
}
