import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { signUp } from "../../lib/api/auth";
import GoogleButton from "../../components/GoogleButton";
import AuthMark from "../../components/AuthMark";
import { safeNext, withNext } from "../../lib/nextPath";

export default function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [params] = useSearchParams();
  // Validated HERE, where it is read, which is what the family app's sign-up page does and
  // what src/lib/nextPath.callsites.test.ts now requires of every read. It used to go into
  // signUp raw, on the grounds that signUp threads it through withNext itself: true, and
  // still a value that was unvalidated across a function boundary, which is a worse shape to
  // copy than it is a bug. safeNext does not ENCODE, only withNext does, so this cannot
  // double-encode the confirmation link, which was the old comment's worry.
  const next = safeNext(params.get("next"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the name your colleagues will see.");
    setBusy(true);
    try {
      await signUp(email, password, name.trim(), next);
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
      <div className="plate auth-card">
        <AuthMark label="Enamel Vault for kitchens" />
        <h1>Check your inbox</h1>
        <p>
          Confirm the address and you will come straight back here. If you were sent an
          invitation, it will still be waiting.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="plate auth-card">
      <AuthMark label="Enamel Vault for kitchens" />
      <h1>Create an account</h1>
      <label htmlFor="name">
        Your name
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label htmlFor="email">
        Email
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
      </label>
      <label htmlFor="password">
        Password
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        Create the account
      </button>
      {/* DELIBERATELY NOT the family app's "by signing up you agree". For the kitchen,
          acceptance is recorded by KitchenTermsGate into kitchen.terms_acceptance against
          KITCHEN_TERMS_VERSION, so claiming it happened here would make this page contradict
          the row that is the actual record. The documents are linked so they can be read
          before committing, which is the part that matters. */}
      <p className="form-consent">
        Read the <Link to="/terms">terms</Link> and the{" "}
        <Link to="/privacy">privacy page</Link> before you start.
      </p>
      <GoogleButton label="Sign up with Google" />
      {/* The destination has to survive this hop too, or an invite dies on the way back. */}
      <p>
        Already have one? <Link to={withNext("/signin", next)}>Sign in</Link>.
      </p>
    </form>
  );
}
