import type { MealPlanItem, MealSlot } from "./api/types";

// Dragging a meal between cells is only an affordance over moveItem, which the day and slot
// dropdowns already call. The decision of WHAT a drop means lives here, away from dnd-kit, so
// it can be tested directly: driving a real drag through synthetic DOM events tests the
// library far more than it tests us.

// A cell's identity travels through dnd-kit as a string. The day is an ISO date and the slot
// is a single word, so a colon cannot appear inside either part.
const CELL = "cell:";

export function cellId(day: string, slot: MealSlot): string {
  return `${CELL}${day}:${slot}`;
}

export function parseCellId(id: string): { day: string; mealSlot: MealSlot } | null {
  if (!id.startsWith(CELL)) return null;
  const [day, slot, ...rest] = id.slice(CELL.length).split(":");
  if (!day || !slot || rest.length > 0) return null;
  return { day, mealSlot: slot as MealSlot };
}

export interface PlanMove { itemId: string; day: string; mealSlot: MealSlot }

// Null means "do nothing", and every null here is a case where writing would be wrong rather
// than merely unnecessary: dropped on nothing, dropped on something that is not a cell, an id
// with no matching item, or dropped back where it started. That last one matters most: a drag
// that ends where it began is the commonest gesture of all (a mis-grab, a changed mind), and
// it must not cost a write or a refresh.
export function resolveDrop(
  activeId: string,
  overId: string | null,
  items: MealPlanItem[],
): PlanMove | null {
  if (!overId) return null;
  const target = parseCellId(overId);
  if (!target) return null;

  const item = items.find((i) => i.id === activeId);
  if (!item) return null;
  if (item.day === target.day && item.meal_slot === target.mealSlot) return null;

  return { itemId: item.id, day: target.day, mealSlot: target.mealSlot };
}
