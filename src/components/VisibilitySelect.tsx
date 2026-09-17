import type { Visibility } from "../lib/api/types";

export default function VisibilitySelect({
  value,
  onChange,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Visibility)}>
      <option value="private">private</option>
      <option value="family">family</option>
      <option value="public">public</option>
    </select>
  );
}
