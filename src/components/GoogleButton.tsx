import { useState } from "react";
import { signInWithGoogle } from "../lib/api/auth";

// Shared by SignIn and SignUp. On Google's side the two are the same act, and
// duplicating the error handling in both pages would mean fixing it twice.
export default function GoogleButton({ label }: { label: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      // On success the browser is already leaving for Google, so busy stays true
      // deliberately: clearing it would flash the button back to ready mid-redirect.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={go} disabled={busy}>
        {busy ? "Taking you to Google..." : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
