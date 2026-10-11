import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOrg } from "../../lib/api/kitchen/orgs";

export default function NewOrg() {
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Checked here as well as in the database, so the refusal names the field rather than
    // arriving as a constraint violation.
    if (!name.trim()) return setError("Give the group a name.");
    if (!displayName.trim()) return setError("Give your own name, which your staff will see.");
    setBusy(true);
    try {
      const id = await createOrg(name.trim(), displayName.trim());
      navigate(`/orgs/${id}/sites`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose plate">
      <h1>Start a kitchen group</h1>
      <form onSubmit={submit}>
        <label htmlFor="org-name">Group name</label>
        <input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="display-name">Your name</label>
        <input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          Create the group
        </button>
      </form>
    </div>
  );
}
