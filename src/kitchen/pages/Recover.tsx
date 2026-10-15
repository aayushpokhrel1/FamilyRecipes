import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { setNewPassword } from "../../lib/api/auth";
import AuthMark from "../../components/AuthMark";

// The other end of "Forgot password?" on the kitchen sign-in. It mirrors the family app's
// src/pages/Recover.tsx, minus reportError, which supabase/kitchen_seal.test.ts forbids here.
//
// WITHOUT THIS ROUTE THE RESET EMAIL IS A DEAD LINK. lib/api/auth.requestPasswordReset sends
// people to `${window.location.origin}/recover`, so from the kitchen host that address has to
// exist here rather than on the family app. It also has to be in the hosted Supabase redirect
// allow list, or Supabase quietly substitutes the Site URL and the link lands on the wrong
// product with no error anywhere.
export default function Recover() {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Validate before calling: the API layer writes user-facing messages, but a
    // mismatch is a client-side fact and costs nothing to catch here.
    if (next !== confirm) {
      setError("Those passwords do not match.");
      return;
    }
    if (next.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    try {
      await setNewPassword(next);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (done) {
    return (
      <div className="plate auth-card">
        <AuthMark />
        <h1>Choose a new password</h1>
        <p role="status">Password updated.</p>
        <p>
          <Link to="/">Go to your kitchen</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <AuthMark />
      <h1>Choose a new password</h1>
      <label htmlFor="new-password">
        New password
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label htmlFor="confirm-password">
        Confirm new password
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Update password</button>
    </form>
  );
}
