import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { setNewPassword } from "../lib/api/auth";

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
        <h1>Choose a new password</h1>
        <p role="status">Password updated.</p>
        <p>
          <Link to="/">Go to your recipes</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="plate auth-card">
      <h1>Choose a new password</h1>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
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
