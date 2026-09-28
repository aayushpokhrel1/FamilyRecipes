import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyProfile } from "../lib/api/profile";
import type { Visibility } from "../lib/api/types";

export default function VisibilitySelect({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  // null means "not loaded yet or lookup failed" as well as "no handle". Both cases are
  // treated the same on purpose: the note is advice, and showing it to someone who already
  // has a handle is a smaller harm than hiding it from someone who does not.
  const [handle, setHandle] = useState<string | null>(null);
  const [needsHandle, setNeedsHandle] = useState(false);

  useEffect(() => {
    let ignore = false;
    getMyProfile()
      .then((p) => { if (!ignore) setHandle(p.handle); })
      .catch(() => { if (!ignore) setHandle(null); });
    return () => { ignore = true; };
  }, []);

  function handleChange(v: Visibility) {
    setNeedsHandle(v === "public" && !handle);
    // The change ALWAYS goes through. recipes_read does not consult the handle, so a recipe
    // set to public genuinely is public whether or not anyone has claimed one; blocking the
    // selection here would misstate what the database does. The byline view left-joins the
    // profile precisely so this case renders as the family name alone.
    onChange(v);
  }

  return (
    <>
      <select
        aria-label="visibility"
        value={value}
        onChange={(e) => handleChange(e.target.value as Visibility)}
      >
        <option value="private">private</option>
        <option value="family">family</option>
        <option value="public">public</option>
      </select>
      {needsHandle && (
        <p className="vault-note">
          This recipe is public, but you have no public name yet, so it will be credited to
          your family alone. Claim a handle in <Link to="/settings">Settings</Link>.
        </p>
      )}
    </>
  );
}
