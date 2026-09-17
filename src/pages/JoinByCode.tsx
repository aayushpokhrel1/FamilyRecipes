import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinByCode } from "../lib/api/families";

export default function JoinByCode() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    joinByCode(code)
      .then(() => navigate("/"))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [code, navigate]);

  return (
    <div>
      <h1>Joining family...</h1>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
