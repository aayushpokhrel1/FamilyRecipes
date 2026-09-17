import { useEffect, useState } from "react";
import { ensureTag, listTags } from "../lib/api/tags";
import type { Tag } from "../lib/api/types";

export default function TagPicker({
  familyId,
  value,
  onChange,
}: {
  familyId: string;
  value: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");

  useEffect(() => {
    listTags(familyId).then(setTags).catch(() => setTags([]));
  }, [familyId]);

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((t) => t !== id));
    else onChange([...value, id]);
  }

  async function handleAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const tag = await ensureTag(familyId, trimmed);
    const fresh = await listTags(familyId);
    setTags(fresh);
    if (!value.includes(tag.id)) onChange([...value, tag.id]);
    setName("");
  }

  return (
    <div>
      <div>
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={value.includes(t.id)}
            onClick={() => toggle(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New tag" />
      <button type="button" onClick={handleAdd}>
        Add tag
      </button>
    </div>
  );
}
