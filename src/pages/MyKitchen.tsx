import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useFamily } from "../context/FamilyContext";
import { listPlans, createPlan, deletePlan, setShared } from "../lib/api/mealPlans";
import type { MealPlan } from "../lib/api/types";

export default function MyKitchen() {
  const { activeFamily } = useFamily();
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try { setPlans(await listPlans()); } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function handleCreate() {
    if (!activeFamily || !name.trim()) return;
    await createPlan(activeFamily.id, name.trim());
    setName("");
    reload();
  }
  async function handleDelete(id: string) {
    await deletePlan(id);
    reload();
  }
  async function handleShare(p: MealPlan) {
    await setShared(p.id, !p.is_shared);
    reload();
  }

  return (
    <div>
      <h1>My Kitchen</h1>
      {!activeFamily && (
        <p>Create or join a family first. <Link to="/families">Families</Link></p>
      )}
      <div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Plan name" />
        <button type="button" onClick={handleCreate} disabled={!activeFamily}>New plan</button>
      </div>
      {loading && <p>Loading...</p>}
      {!loading && plans.length === 0 && <p>No plans yet.</p>}
      <ul>
        {plans.map((p) => (
          <li key={p.id}>
            <Link to={`/kitchen/${p.id}`}>{p.name}</Link>
            <button type="button" onClick={() => handleShare(p)}>
              {p.is_shared ? "Shared (make private)" : "Share with family"}
            </button>
            <button type="button" onClick={() => handleDelete(p.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
