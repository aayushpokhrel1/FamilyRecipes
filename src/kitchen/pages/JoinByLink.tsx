import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { acceptInvite, peekInvite } from "../../lib/api/kitchen/invites";
import type { Invite } from "../../lib/api/kitchen/types";
import { useAuth } from "../../context/AuthContext";
import { withNext } from "../../lib/nextPath";

const ROLE_WORDS: Record<Invite["role"], string> = {
  owner: "an owner",
  chef: "a chef",
  site_manager: "a site manager",
  cook: "a cook",
};

export default function JoinByLink() {
  const { code = "" } = useParams();
  const { userId, loading } = useAuth();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [checked, setChecked] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Peeked, never accepted, on load. A forwarded link must not employ the person who opens it.
  useEffect(() => {
    peekInvite(code)
      .then(setInvite)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not read that link."))
      .finally(() => setChecked(true));
  }, [code]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the name your colleagues will see.");
    setBusy(true);
    try {
      await acceptInvite(code, name.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!checked || loading) return <div className="prose plate">Loading.</div>;

  if (!invite) {
    return (
      <div className="prose plate">
        <h1>That link is not valid any more</h1>
        <p role="alert">
          It may have been used already, or it may never have been a link to this kitchen. Ask
          whoever sent it for another one.
        </p>
      </div>
    );
  }

  return (
    <div className="prose plate">
      <h1>You have been invited</h1>
      <p>
        <strong>{invite.org_name}</strong> would like you to join as {ROLE_WORDS[invite.role]}
        {invite.site_name ? ` at ${invite.site_name}` : ""}.
      </p>
      {userId ? (
        <form onSubmit={join}>
          <label htmlFor="join-name">Your name</label>
          <input id="join-name" value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p role="alert">{error}</p>}
          {/* Nothing has happened until this is pressed. */}
          <button type="submit" disabled={busy}>
            Join {invite.org_name}
          </button>
        </form>
      ) : (
        <>
          <p>Sign in and this invitation will still be waiting.</p>
          {/* The destination rides in the URL, because signing in leaves the page: Google goes
              through another origin and a confirmation link is opened later, often in another
              tab. Router state does not survive either. */}
          <p>
            <Link to={withNext("/signin", `/join/${code}`)}>Sign in</Link> or{" "}
            <Link to={withNext("/signup", `/join/${code}`)}>create an account</Link>.
          </p>
        </>
      )}
    </div>
  );
}
