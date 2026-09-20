import { useState, type FormEvent } from "react";
import { createFamily, joinByCode } from "../lib/api/families";
import { useFamily } from "../context/FamilyContext";

export default function Families() {
  const { families, reload } = useFamily();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createFamily(name);
      setName("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await joinByCode(code);
      setCode("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div>
      <h1>Families</h1>
      {families.length === 0 ? (
        <p className="vault-note">
          You don't have any families yet. Create one below, or join an existing
          family with an invite code.
        </p>
      ) : (
        <ul className="stack">
          {families.map((f) => (
            <li key={f.id} className="plate plate-row">
              <span className="row-title">{f.name}</span>
              <code>{f.invite_code}</code>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
      <form onSubmit={handleCreate}>
        <h2>Create family</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button type="submit">Create</button>
      </form>
      <form onSubmit={handleJoin}>
        <h2>Join by code</h2>
        <label>
          Invite code
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <button type="submit">Join</button>
      </form>
    </div>
  );
}
