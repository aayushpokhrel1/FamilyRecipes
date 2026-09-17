import type { Step } from "../lib/api/types";

export default function StepEditor({
  items,
  onChange,
}: {
  items: Step[];
  onChange: (items: Step[]) => void;
}) {
  function update(index: number, text: string) {
    onChange(items.map((s, i) => (i === index ? { ...s, text } : s)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div>
      <h2>Steps</h2>
      {items.map((s, i) => (
        <div key={i}>
          <input
            value={s.text}
            onChange={(e) => update(i, e.target.value)}
            placeholder="Step"
          />
          <button type="button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { position: items.length, text: "" }])}
      >
        Add step
      </button>
    </div>
  );
}
