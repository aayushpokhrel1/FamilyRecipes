import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { signUp } from "../../lib/api/auth";
import { withNext } from "../../lib/nextPath";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the name your colleagues will see.");
    setBusy(true);
    try {
      // params.get("next") goes in RAW. signUp threads it through withNext itself, and
      // encoding it here as well would send a confirmation link to a path containing %252F.
      await signUp(email, password, name.trim(), params.get("next"));
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  // With email confirmation on, Supabase returns a user but NO session until the link is
  // clicked, so there is nowhere to navigate to. Saying so is the whole content of this state.
  if (sent) {
    return (
      <div className="prose plate">
        <h1>Check your inbox</h1>
        <p>
          Confirm the address and you will come straight back here. If you were sent an
          invitation, it will still be waiting.
        </p>
      </div>
    );
  }

  return (
    <div className="prose plate">
      <h1>Create an account</h1>
      <form onSubmit={submit}>
        <label htmlFor="name">Your name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Create the account
        </button>
      </form>
      <p>
        Already have one? <Link to={withNext("/signin", params.get("next"))}>Sign in</Link>.
      </p>
    </div>
  );
}
