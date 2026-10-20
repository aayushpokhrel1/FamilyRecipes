import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { eraseOrg, listStaff, myOrgs } from "../../lib/api/kitchen/orgs";
import type { StaffMember } from "../../lib/api/kitchen/types";
import { useAuth } from "../../context/AuthContext";
import { useMyRole } from "../lib/useMyRole";

// The warning has to read like a sentence a person would write, because the numbers are the
// damage: "0 people" is a confirmation that says nothing.
function peopleWords(n: number): string {
  if (n === 0) return "nobody else";
  return n === 1 ? "1 person" : `${n} people`;
}

function ownersWords(n: number): string {
  return n === 1 ? "1 other owner" : `${n} other owners`;
}

export default function OrgSettings() {
  const { id = "" } = useParams();
  const { role } = useMyRole(id);
  const { userId } = useAuth();
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listStaff(id), myOrgs()])
      .then(([roster, orgs]) => {
        setStaff(roster);
        setOrgName(orgs.find((o) => o.id === id)?.name ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, [id]);

  // Everything below is DERIVED during render, never seeded into useState: a useState initial
  // value is captured on the first render only, and the roster and the name arrive later.
  const others = staff.filter((m) => m.user_id !== userId);
  const otherOwners = others.filter((m) => m.role === "owner").length;
  // The typed text is the confirmation, so the control stays disabled until it matches the
  // group's name exactly. No name yet means nothing can match.
  const matches = orgName !== null && typed === orgName;

  async function erase() {
    setError(null);
    setBusy(true);
    try {
      await eraseOrg(id);
      // The group is gone, so the page it was on is gone too: back to the list of groups.
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prose plate">
      <h1>Settings</h1>
      {/* `erase_org` is the owner's alone and refuses everybody else, so the control is the
          owner's too: a page must not render a control its viewer's policy will refuse. */}
      {role !== "owner" ? (
        <p>Only an owner can erase a group.</p>
      ) : otherOwners > 0 ? (
        // The database is still the real guard (KIT02); this is the courtesy, so nobody types
        // the name of their group only to be told no.
        <p>
          {ownersWords(otherOwners)} {otherOwners === 1 ? "has" : "have"} to be removed first.
          A group is erased by its last owner.
        </p>
      ) : (
        <>
          <h2>Erase this group</h2>
          <p>
            Erasing takes every published dish down from Potluck first, then deletes the group
            and everything in it: sites, staff, dishes, every version, every sign-off and every
            deviation. The sign-off record goes with the group. It cannot be undone.
          </p>
          <p>
            {others.length === 0
              ? "Nobody else will lose access: you are the only person in this group."
              : `${peopleWords(others.length)} will lose access, along with every site and every dish.`}
          </p>
          <label htmlFor="confirm-name">
            Type the group's name to confirm{orgName !== null ? `: ${orgName}` : ""}
          </label>
          <input
            id="confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
          />
          <button type="button" disabled={busy || !matches} onClick={erase}>
            Erase this group
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
