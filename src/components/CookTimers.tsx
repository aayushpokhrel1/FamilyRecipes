// Every running timer, on every page that has the app shell.
//
// It mounts in AppLayout rather than in CookMode so a timer stays visible and keeps ringing
// while you check the grocery list. AppLayout also wraps the four PUBLIC documents and the
// public recipe page, so this renders with no session and no active family: IT MUST NOT READ
// EITHER, and it renders nothing whatever when no timer is running, which is what keeps it free
// for those pages.

import { useEffect, useState } from "react";
import { list, subscribe, cancel, dismiss, onRing, type CookTimer } from "../lib/cookTimers";
import { ring } from "../lib/cookAlarm";

function remaining(timer: CookTimer, now: number): string {
  const total = Math.max(0, Math.round((timer.endsAt - now) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function CookTimers() {
  const [items, setItems] = useState<CookTimer[]>(list);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribe(() => setItems([...list()])), []);
  useEffect(() => onRing((t) => ring(t)), []);

  useEffect(() => {
    if (items.length === 0) return;
    const handle = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(handle);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div className="cook-timers">
      {items.map((t) => (
        <div
          key={t.id}
          className={t.ringing ? "cook-timer is-ringing" : "cook-timer"}
          role={t.ringing ? "alert" : undefined}
        >
          <span className="cook-timer-time">{t.ringing ? "Done" : remaining(t, now)}</span>
          <span className="cook-timer-what">
            {t.recipeTitle}, step {t.stepNumber}, {t.label}
          </span>
          {t.ringing ? (
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label={`Dismiss the ${t.label} timer for ${t.recipeTitle}`}
            >
              Dismiss
            </button>
          ) : (
            <button
              type="button"
              onClick={() => cancel(t.id)}
              aria-label={`Cancel the ${t.label} timer for ${t.recipeTitle}`}
            >
              Cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
