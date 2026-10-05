import { useState, type FormEvent } from "react";
import { createFamily, joinByCode } from "../lib/api/families";
import { useFamily } from "../context/FamilyContext";

export default function Families() {
  const { families, reload } = useFamily();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Keyed by family id so copying one family's link does not relabel another's buttons.
  const [copied, setCopied] = useState<Record<string, "link" | "code" | null>>({});
  // The fallback for a clipboard that is missing or refuses: the link as selectable text.
  const [manual, setManual] = useState<Record<string, string | null>>({});

  async function copy(familyId: string, kind: "link" | "code", text: string) {
    try {
      // undefined on an insecure origin, and it rejects in some browsers, so this is
      // wrapped: silently doing nothing is the one unacceptable outcome.
      await navigator.clipboard.writeText(text);
      setCopied((c) => ({ ...c, [familyId]: kind }));
      setTimeout(() => setCopied((c) => ({ ...c, [familyId]: null })), 2000);
    } catch {
      setManual((m) => ({ ...m, [familyId]: text }));
    }
  }

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
          {families.map((f) => {
            const link = `${window.location.origin}/join/${f.invite_code}`;
            return (
              <li key={f.id} className="plate plate-row">
                <span className="row-title">{f.name}</span>
                <code>{f.invite_code}</code>
                <button type="button" onClick={() => copy(f.id, "link", link)}>
                  {copied[f.id] === "link" ? "Copied" : "Copy invite link"}
                </button>
                <button type="button" onClick={() => copy(f.id, "code", f.invite_code)}>
                  {copied[f.id] === "code" ? "Copied" : "Copy code"}
                </button>
                {manual[f.id] && (
                  <input readOnly value={manual[f.id] ?? ""} aria-label="Invite link" />
                )}
              </li>
            );
          })}
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
