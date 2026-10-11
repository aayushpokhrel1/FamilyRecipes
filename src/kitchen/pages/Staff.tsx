import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { listSites, listStaff } from "../../lib/api/kitchen/orgs";
import { createInvite } from "../../lib/api/kitchen/invites";
import type { Site, StaffMember, StaffRole } from "../../lib/api/kitchen/types";

const ROLES: StaffRole[] = ["chef", "site_manager", "cook"];
const ROLE_LABEL: Record<StaffRole, string> = {
  owner: "Owner",
  chef: "Chef",
  site_manager: "Site manager",
  cook: "Cook",
};

export default function Staff() {
  const { id = "" } = useParams();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [role, setRole] = useState<StaffRole>("chef");
  const [siteId, setSiteId] = useState<string>("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listStaff(id), listSites(id)])
      .then(([s, si]) => {
        setStaff(s);
        setSites(si);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load."));
  }, [id]);

  async function makeLink() {
    setError(null);
    setLink(null);
    try {
      // A group-wide role carries no site. Sending "" would be neither a uuid nor null.
      const site = role === "owner" || role === "chef" ? null : siteId || null;
      const code = await createInvite(id, role, site);
      // Built from the current origin so it is correct in dev, on a preview and in
      // production, rather than hardcoding the production host.
      setLink(`${window.location.origin}/join/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    }
  }

  return (
    <div className="prose plate">
      <h1>Your staff</h1>
      <ul>
        {staff.map((member) => (
          <li key={member.user_id}>
            {member.display_name} <span className="muted">{ROLE_LABEL[member.role]}</span>
          </li>
        ))}
      </ul>

      <h2>Invite somebody</h2>
      <label htmlFor="role">Role</label>
      <select id="role" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {role !== "chef" && (
        <>
          <label htmlFor="site">Site</label>
          <select id="site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">No site, group wide</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="button" onClick={makeLink}>
        Make a link
      </button>
      {error && <p role="alert">{error}</p>}
      {/* Shown to be copied. We send no email: who the link reaches is the owner's business. */}
      {link && <p>{link}</p>}
    </div>
  );
}
