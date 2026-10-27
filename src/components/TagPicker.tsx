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
  const [filter, setFilter] = useState("");

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

  // Every family tag rendered as a button, forever, eventually pushes the rest of the form
  // off the screen. A filter earns its place only once there are enough tags to hunt through;
  // below that it is one more box between a cook and saving a recipe.
  const FILTER_FROM = 12;
  const needle = filter.trim().toLowerCase();
  // A selected tag always shows, even when it does not match: hiding what is already ticked
  // makes it look unticked, and you cannot untick what you cannot see.
  const shown = needle
    ? tags.filter((t) => t.name.toLowerCase().includes(needle) || value.includes(t.id))
    : tags;

  return (
    <div>
      {tags.length > FILTER_FROM && (
        <input
          className="tag-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${tags.length} tags`}
          aria-label="Filter tags"
        />
      )}
      <div className="tag-row">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={value.includes(t.id)}
            onClick={() => toggle(t.id)}
          >
            {t.name}
          </button>
        ))}
        {/* TWO DIFFERENT EMPTY STATES, and the wrong one shipped to every new cook. With no
            tags at all, "No tag matches that" answers a question nobody asked: the filter box
            above only renders past twelve tags, so a first-time cook was being told their
            search had failed while no search box existed on the page. Found on a fresh account
            in a browser, 2026-10-26, which is the only way this one was ever going to show up:
            with any tags in the account it is unreachable. */}
        {shown.length === 0 && (
          <p className="vault-note">
            {needle ? "No tag matches that." : "No tags yet. Add one below."}
          </p>
        )}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New tag"
        aria-label="New tag name"
      />
      <button type="button" onClick={handleAdd}>
        Add tag
      </button>
    </div>
  );
}
