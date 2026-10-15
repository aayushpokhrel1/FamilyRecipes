import { useEffect, useState } from "react";
import IngredientCatalogPicker from "./IngredientCatalogPicker";
import type { Ingredient } from "../lib/api/types";
import { mergeItemSuggestions, mergeSectionSuggestions, categoryFor, CATEGORY_ORDER } from "../lib/catalog";
import { listCategoryOverrides, setCategoryOverride } from "../lib/api/ingredientCategories";

export default function IngredientEditor({
  items,
  onChange,
  itemSuggestions = [],
  sectionSuggestions = [],
  familyId,
}: {
  items: Ingredient[];
  onChange: (items: Ingredient[]) => void;
  itemSuggestions?: string[];
  sectionSuggestions?: string[];
  familyId?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [namingRow, setNamingRow] = useState<number | null>(null);
  const [typedSection, setTypedSection] = useState("");

  const [overrides, setOverrides] = useState<Map<string, string>>(new Map());
  const [aisleError, setAisleError] = useState<string | null>(null);

  // The family's own aisle tags. A failure leaves the map empty and the editor still works.
  useEffect(() => {
    if (!familyId) return;
    let ignore = false;
    listCategoryOverrides(familyId)
      .then((m) => { if (!ignore) setOverrides(m); })
      .catch(() => { if (!ignore) setOverrides(new Map()); });
    return () => { ignore = true; };
  }, [familyId]);

  // Every other mirror of this setter surfaces its failure. Without the catch a refused
  // write is an unhandled rejection and the select just snaps back to "Set aisle...", which
  // reads to the cook as "it worked" when nothing was saved.
  async function handleSetAisle(item: string, category: string) {
    if (!familyId || !category) return;
    try {
      setAisleError(null);
      await setCategoryOverride(familyId, item, category);
      setOverrides(await listCategoryOverrides(familyId));
    } catch (e: any) { setAisleError(e.message); }
  }

  function update(index: number, patch: Partial<Ingredient>) {
    onChange(items.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  const usedSections = Array.from(
    new Set(items.map((g) => g.section).filter((s): s is string => !!s && s.trim() !== "")),
  );

  // The lowest-index row sharing a non-empty alt_group is the group's primary.
  // A primary is not an alternative to anything, and cannot be a target either.
  function primaryIndex(group: string | null | undefined) {
    if (!group) return -1;
    return items.findIndex((g) => g.alt_group === group);
  }

  function isPrimary(index: number) {
    const group = items[index]?.alt_group;
    if (!group) return false;
    const first = primaryIndex(group);
    return first === index && items.some((g, k) => k !== index && g.alt_group === group);
  }

  // The ingredient this row is an alternative TO: the primary of its group.
  function alternativeTo(index: number) {
    const group = items[index]?.alt_group;
    if (!group) return "";
    const first = primaryIndex(group);
    if (first === index) return "";
    return String(first);
  }

  function chooseAlternative(index: number, value: string) {
    if (value === "") {
      update(index, { alt_group: null });
      return;
    }
    const target = Number(value);
    const targetGroup = items[target]?.alt_group;
    if (targetGroup) {
      update(index, { alt_group: targetGroup });
      return;
    }
    const group = crypto.randomUUID();
    onChange(items.map((g, i) => {
      if (i === index) return { ...g, alt_group: group };
      if (i === target) return { ...g, alt_group: group };
      return g;
    }));
  }

  function startNaming(index: number) {
    setTypedSection("");
    setNamingRow(index);
  }

  function commitNaming(index: number) {
    update(index, { section: typedSection.trim() || null });
    setNamingRow(null);
    setTypedSection("");
  }

  // Sections already in this recipe sit in their own group at the top; the rest
  // are offered below without repeating them.
  const usedKeys = new Set(usedSections.map((x) => x.toLowerCase()));
  const offered = mergeSectionSuggestions(sectionSuggestions)
    .filter((x) => !usedKeys.has(x.toLowerCase()));
  const familyKeys = new Set(sectionSuggestions.map((x) => x.trim().toLowerCase()));
  const mine = offered.filter((x) => familyKeys.has(x.toLowerCase()));
  const common = offered.filter((x) => !familyKeys.has(x.toLowerCase()));

  return (
    <div>
      <h2>Ingredients</h2>
      {items.map((g, i) => (
        <div key={i} className="editor-row">
          {/* These three carried a placeholder and nothing else, so a screen reader read the
              whole row as three identical blank fields. The labels name the row the way the
              selects below already do, which is why they interpolate g.item. */}
          <input
            value={g.quantity ?? ""}
            onChange={(e) => update(i, { quantity: e.target.value })}
            placeholder="Qty"
            aria-label={`Quantity for ${g.item || "this ingredient"}`}
          />
          <input
            value={g.unit ?? ""}
            onChange={(e) => update(i, { unit: e.target.value })}
            placeholder="Unit"
            aria-label={`Unit for ${g.item || "this ingredient"}`}
          />
          <input
            value={g.item}
            onChange={(e) => update(i, { item: e.target.value })}
            placeholder="Item"
            list="ingredient-items"
            aria-label="Ingredient name"
          />
          <select
            aria-label={`Section for ${g.item || "this ingredient"}`}
            value={g.section && g.section.trim() ? g.section : ""}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "__new") startNaming(i);
              else update(i, { section: value || null });
            }}
          >
            <option value="">No section</option>
            {usedSections.length > 0 && (
              <optgroup label="Used in this recipe">
                {usedSections.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
            {mine.length > 0 && (
              <optgroup label="Your sections">
                {mine.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
            {common.length > 0 && (
              <optgroup label="Common">
                {common.map((s) => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            )}
            <option value="__new">New section...</option>
          </select>
          {namingRow === i && (
            <span className="section-namer">
              <input
                autoFocus
                value={typedSection}
                onChange={(e) => setTypedSection(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); commitNaming(i); }
                  else if (e.key === "Escape") { setNamingRow(null); setTypedSection(""); }
                }}
                placeholder="Section name"
                aria-label={`New section name for ${g.item || "this ingredient"}`}
              />
              <button type="button" onClick={() => commitNaming(i)}>Done</button>
            </span>
          )}
          <label>
            <input
              type="checkbox"
              checked={g.optional ?? false}
              onChange={(e) => update(i, { optional: e.target.checked })}
              aria-label={`Optional for ${g.item || "this ingredient"}`}
            />
            Optional
          </label>
          <select
            aria-label={`Alternative to for ${g.item || "this ingredient"}`}
            value={alternativeTo(i)}
            disabled={isPrimary(i)}
            onChange={(e) => chooseAlternative(i, e.target.value)}
          >
            <option value="">Not an alternative</option>
            {/* A primary IS offered as a target: that is how a group grows a third
                alternative, and excluding it would blank this select the moment the row
                it points at became a primary. What must not happen is a primary becoming
                somebody else's alternative, and the `disabled` above is what stops that. */}
            {items.map((other, k) => {
              if (k === i) return null;
              return <option key={k} value={String(k)}>{other.item || `ingredient ${k + 1}`}</option>;
            })}
          </select>
          {/* Only on a named row the catalog cannot place, and only when the page gave us a
              family to write to. A row already in the right aisle gains no clutter: this row
              is wide enough already. */}
          {familyId && g.item.trim() !== "" && categoryFor(g.item, overrides) === null && (
            <span className="aisle-setter">
              <select
                aria-label={`Set aisle for ${g.item}`}
                value=""
                onChange={(e) => handleSetAisle(g.item, e.target.value)}
              >
                <option value="">Set aisle...</option>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </span>
          )}
          <button type="button" onClick={() => remove(i)}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, { position: items.length, quantity: "", unit: "", item: "", section: items[items.length - 1]?.section ?? null }])}
      >
        Add ingredient
      </button>
      <button type="button" onClick={() => setShowPicker(true)}>Add from list</button>
      {aisleError && <p className="form-error" role="alert">{aisleError}</p>}
      <datalist id="ingredient-items">
        {mergeItemSuggestions(itemSuggestions).map((name) => <option key={name} value={name} />)}
      </datalist>
      {showPicker && (
        <IngredientCatalogPicker
          defaultSection={items[items.length - 1]?.section ?? null}
          onClose={() => setShowPicker(false)}
          onAdd={(names, section) =>
            onChange([
              ...items,
              ...names.map((item, k) => ({ position: items.length + k, quantity: "", unit: "", item, section })),
            ])
          }
        />
      )}
    </div>
  );
}
