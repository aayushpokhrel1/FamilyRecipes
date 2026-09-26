import { useEffect, useState, type FormEvent } from "react";
import {
  hasProvider,
  linkGoogle,
  listIdentities,
  unlinkIdentity,
  type UserIdentity,
} from "../lib/api/identities";
import { setFirstPassword } from "../lib/api/auth";

type Status = { kind: "ok" | "error"; text: string } | null;

const NAMES: Record<string, string> = { email: "Email and password", google: "Google" };
const nameFor = (p: string) => NAMES[p] ?? p;

export default function IdentitiesPanel() {
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    listIdentities()
      .then(setIdentities)
      .catch((err: unknown) => {
        setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
      });
  }
  useEffect(load, []);

  async function run(fn: () => Promise<void>, okText?: string) {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
      if (okText) setStatus({ kind: "ok", text: okText });
      load();
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleFirstPassword(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setStatus({ kind: "error", text: "Those passwords do not match." });
      return;
    }
    await run(() => setFirstPassword(password), "Password set. You can now sign in with either.");
    setPassword("");
    setConfirm("");
  }

  if (!identities) return <p className="vault-note">Loading...</p>;

  const google = identities.find((i) => i.provider === "google");
  const isOnlyIdentity = identities.length < 2;

  return (
    <>
      {/* One line rather than a <ul>: there are at most two of these, and every
          other note on this page is a .vault-note paragraph. A list would have
          needed its own reset to stop the browser's bullets and indent. */}
      <p className="vault-note">
        You can sign in with: {identities.map((i) => nameFor(i.provider)).join(", ")}
      </p>

      {google ? (
        <>
          <button
            type="button"
            disabled={busy || isOnlyIdentity}
            onClick={() => run(() => unlinkIdentity(google), "Google disconnected.")}
          >
            Disconnect Google
          </button>
          {/* Supabase refuses to remove a last identity, and an unexplained refusal
              on a security screen is alarming. Say why BEFORE it is pressed. */}
          {isOnlyIdentity && (
            <p className="vault-note">
              This is the only way into your account, so it cannot be disconnected. Set a
              password below first.
            </p>
          )}
        </>
      ) : (
        <button type="button" disabled={busy} onClick={() => run(linkGoogle)}>
          Connect Google
        </button>
      )}

      {/* A Google-only account has no password, so the ordinary change-password form
          cannot serve it: that form proves the current password first, and there is
          none. This is the separate path. */}
      {!hasProvider(identities, "email") && (
        <form onSubmit={handleFirstPassword}>
          <p className="vault-note">
            You sign in with Google only. Set a password to be able to sign in without it.
          </p>
          <div className="settings-field">
            <label htmlFor="first-password">New password</label>
            <input
              id="first-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="settings-field">
            <label htmlFor="first-password-confirm">Confirm password</label>
            <input
              id="first-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <button type="submit" disabled={busy}>Set password</button>
        </form>
      )}

      {status?.kind === "ok" && <p className="vault-note" role="status">{status.text}</p>}
      {status?.kind === "error" && <p className="form-error" role="alert">{status.text}</p>}
    </>
  );
}
