// The running Cook Mode timers.
//
// THIS IS A MODULE-LEVEL STORE AND NOT A REACT CONTEXT VALUE, DELIBERATELY. A timer has to
// outlive the screen that started it: the requirement is that you can leave Cook Mode to check
// the grocery list and come back to a running timer. React unmounts CookMode when you navigate,
// so an interval owned by that component would die with it and the timer would silently RESUME
// on your return rather than having rung on time. A timer that is quiet exactly during the
// window you left the page is worse than no timer.
//
// EVERY TIMER STORES AN ABSOLUTE endsAt, NEVER A REMAINING COUNT. Remaining time is always
// endsAt - Date.now(). That is what makes this correct across a reload, a hidden tab whose
// timers the browser throttles to roughly once a minute, and a laptop that was asleep: a late
// tick is then late to ANNOUNCE and never wrong about the number, and a tab that wakes to find
// three timers due rings all three. A decrementing counter would be silently wrong in every one
// of those cases, so do not "simplify" this into one.
//
// Ringing with the browser fully CLOSED is out of scope and was not an oversight. A Service
// Worker cannot hold a timer, because it is terminated when idle and pending timers die with
// it, and the one API that scheduled a notification without a server is gone from Chromium and
// never existed in Safari. See the spec for what Web Push would cost.

const KEY = "cookTimers";
/** A timer that expired this long ago is not news. */
const STALE_MS = 60 * 60 * 1000;

export interface CookTimer {
  id: string;
  recipeId: string;
  recipeTitle: string;
  /** 1-based, matching ?step in CookMode. */
  stepNumber: number;
  /** The duration phrase as written. */
  label: string;
  /**
   * Position of the duration within the step text. PART OF THE IDENTITY: a step can say
   * "fry 5 minutes, rest 5 minutes", so recipe + step + label is not unique.
   */
  matchIndex: number;
  /** Absolute epoch ms. Never a remaining count. */
  endsAt: number;
  ringing: boolean;
}

let items: CookTimer[] = [];
let handle: ReturnType<typeof setInterval> | null = null;
const watchers = new Set<() => void>();
const ringers = new Set<(t: CookTimer) => void>();

function isTimer(v: unknown): v is CookTimer {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === "string"
    && typeof t.recipeId === "string"
    && typeof t.recipeTitle === "string"
    && typeof t.stepNumber === "number"
    && typeof t.label === "string"
    && typeof t.matchIndex === "number"
    && typeof t.endsAt === "number"
    && Number.isFinite(t.endsAt);
}

function load(): CookTimer[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const now = Date.now();
  return parsed
    .filter(isTimer)
    // Stale by over an hour: dropped, not rung. A browser opened the next morning must not
    // greet someone with three alarms. Stale by less: restored ringing, because that one
    // probably did matter and was missed.
    .filter((t) => t.endsAt > now - STALE_MS)
    .map((t) => ({ ...t, ringing: t.endsAt <= now }));
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Private window, blocked site data, or a full quota. The feature works for the
    // session without persistence, which is strictly better than throwing.
  }
}

function changed(): void {
  save();
  for (const fn of watchers) fn();
  if (items.length > 0) ensureTicking();
  else stopTicking();
}

function tick(): void {
  const now = Date.now();
  const due = items.filter((t) => !t.ringing && t.endsAt <= now);
  if (due.length === 0) return;
  items = items.map((t) => (due.some((d) => d.id === t.id) ? { ...t, ringing: true } : t));
  for (const t of due) for (const fn of ringers) fn(t);
  changed();
}

function ensureTicking(): void {
  if (handle !== null) return;
  handle = setInterval(tick, 1000);
}

function stopTicking(): void {
  if (handle === null) return;
  clearInterval(handle);
  handle = null;
}

export function list(): CookTimer[] {
  return items;
}

export function findRunning(
  recipeId: string,
  stepNumber: number,
  matchIndex: number,
): CookTimer | undefined {
  return items.find(
    (t) => t.recipeId === recipeId && t.stepNumber === stepNumber && t.matchIndex === matchIndex,
  );
}

export function start(input: {
  recipeId: string;
  recipeTitle: string;
  stepNumber: number;
  label: string;
  matchIndex: number;
  seconds: number;
}): CookTimer {
  const { seconds, ...rest } = input;
  const timer: CookTimer = {
    ...rest,
    id: crypto.randomUUID(),
    endsAt: Date.now() + seconds * 1000,
    ringing: false,
  };
  items = [...items, timer];
  changed();
  return timer;
}

/** A running timer, stopped early. */
export function cancel(id: string): void {
  remove(id);
}

/**
 * A ringing timer, acknowledged. The same operation on the data as cancel and a different
 * event for the person, which is why they are two functions: keeping them apart means the
 * strip cannot offer "dismiss" for something that has not rung.
 */
export function dismiss(id: string): void {
  remove(id);
}

function remove(id: string): void {
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  changed();
}

export function subscribe(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}

export function onRing(fn: (t: CookTimer) => void): () => void {
  ringers.add(fn);
  return () => ringers.delete(fn);
}

/** Re-reads persisted state, as a reload would. Exported for tests only. */
export function resetForTests(): void {
  stopTicking();
  items = load();
  if (items.length > 0) ensureTicking();
}

items = load();
if (items.length > 0) ensureTicking();
