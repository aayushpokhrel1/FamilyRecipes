import { useFamily } from "../context/FamilyContext";

export default function FamilySwitcher() {
  const { families, activeFamily, setActiveFamily } = useFamily();

  if (families.length === 0) return <p>No families yet.</p>;

  return (
    <select
      value={activeFamily?.id ?? ""}
      onChange={(e) => {
        const family = families.find((f) => f.id === e.target.value);
        if (family) setActiveFamily(family);
      }}
    >
      {families.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}
