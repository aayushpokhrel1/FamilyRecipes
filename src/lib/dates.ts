// Plain YYYY-MM-DD date maths for meal plans. Deliberately never touches
// toISOString(): that converts to UTC, so local midnight in any UTC+ timezone
// reports the PREVIOUS day, which silently shifts a whole planned week. Noon
// anchoring keeps a DST transition from moving the date either.
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "Mon 22", the column label for a day in the week grid.
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${d.getDate()}`;
}
