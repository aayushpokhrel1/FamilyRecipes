import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { familyNameForCode, joinByCode } from "../lib/api/families";
import { useAuth } from "../context/AuthContext";
import { useFamily } from "../context/FamilyContext";
import Skeleton from "../components/Skeleton";

// This page no longer joins on mount. An invite link gets forwarded, pasted into group
// chats and opened by accident, so joining has to be something the person chose, not a
// side effect of opening a URL.
//
// It is also public on purpose: the person an invite is for is often the one who has no
// account yet, so the page has to be readable signed out and ask for a sign-in itself.
export default function JoinByCode() {
  const { code } = useParams();
  const { userId, loading: authLoading } = useAuth();
  const { reload } = useFamily();
  const navigate = useNavigate();
  // undefined means still loading, null means no family has that code.
  const [name, setName] = useState<string | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let ignore = false;
    familyNameForCode(code)
      .then((n) => {
        if (!ignore) setName(n);
      })
      // A failed lookup and a missing code read the same to the visitor: the link is dead.
      .catch(() => {
        if (!ignore) setName(null);
      });
    return () => {
      ignore = true;
    };
  }, [code]);

  async function handleJoin() {
    if (!code) return;
    setError(null);
    setJoining(true);
    try {
      await joinByCode(code);
      await reload();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setJoining(false);
    }
  }

  return (
    <div>
      <h1>Invitation</h1>
      <div className="plate panel">
        {/* authLoading matters as much as the name: userId is null until the session
            resolves, so without it a signed-in visitor is shown "Create an account to join"
            for a beat and may well click it. */}
        {name === undefined || authLoading ? (
          <Skeleton shape="plate" count={1} />
        ) : name === null ? (
          <>
            <p>That invite link does not work any more.</p>
            <p className="vault-note">
              Ask whoever sent it for a new one. A family can change its code, which retires
              every link it has sent.
            </p>
          </>
        ) : userId === null ? (
          <>
            <p>
              You have been invited to join <strong>{name}</strong>.
            </p>
            <Link className="action" to="/signup" state={{ from: { pathname: `/join/${code}` } }}>
              Create an account to join
            </Link>
            <Link to="/signin" state={{ from: { pathname: `/join/${code}` } }}>
              Already have an account? Sign in
            </Link>
          </>
        ) : (
          <>
            <p>
              Join <strong>{name}</strong>?
            </p>
            <button type="button" className="action" onClick={handleJoin} disabled={joining}>
              Join this family
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
