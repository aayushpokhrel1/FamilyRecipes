// The three channels a finished timer announces itself on, in order of reliability.
//
// THE AUDIO CONTEXT IS BUILT ON THE STARTING TAP, NOT AT RING TIME, AND THAT IS THE POINT OF
// armAlarm(). Autoplay policy suppresses audio that has no user gesture behind it, and it does
// so SILENTLY: no exception, no console warning, just no sound. Tapping a duration chip is a
// real gesture, so the context created there is permitted to make noise twenty minutes later.
// Move this into ring() and the alarm fails exactly when it matters, in a way no test that
// stubs AudioContext can see.
//
// The sound is generated rather than shipped: no binary in the repo, no decode, and no question
// about the Worker's Content-Security-Policy, which has no media-src and so falls back to
// default-src 'self'.
//
// Notification is the only channel that can be absent. On iOS Safari it reaches a site only
// once that site is installed to the Home Screen, so the beep and the on-screen strip are what
// carry this feature there, and a refusal costs no function.

import type { CookTimer } from "./cookTimers";

let ctx: AudioContext | null = null;

type Ctor = new () => AudioContext;

function audioCtor(): Ctor | null {
  const w = globalThis as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function notificationApi():
  | (typeof Notification & { permission: NotificationPermission })
  | null {
  const w = globalThis as unknown as { Notification?: typeof Notification };
  return typeof w.Notification === "function" ? (w.Notification as never) : null;
}

/** Call from the user gesture that starts a timer. Safe to call repeatedly. */
/**
 * Drops the held AudioContext. Exported for tests only: the context is deliberately kept
 * for the whole session in a browser, which means it also survives between tests and a
 * stubbed global from an earlier test would otherwise still be the one in use.
 */
export function resetAlarmForTests(): void {
  ctx = null;
}

export function armAlarm(): void {
  const Ctor = audioCtor();
  if (Ctor && !ctx) {
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
  }
  if (ctx && ctx.state === "suspended") {
    void ctx.resume().catch(() => {});
  }

  const api = notificationApi();
  // The browser persists its own answer per origin, so "default" is the only state worth
  // asking in. Once granted or denied we never ask again and need no flag of our own to
  // remember that, which is also why this needs no storage key.
  if (api && api.permission === "default") {
    try {
      void api.requestPermission().catch(() => {});
    } catch {
      // Older Safari rejects rather than returning a promise.
    }
  }
}

function beep(): void {
  if (!ctx) return;
  try {
    // Three short pulses, which reads as an alarm rather than a notification chime.
    for (let i = 0; i < 3; i++) {
      const at = ctx.currentTime + i * 0.3;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    }
  } catch {
    // The strip is still showing the alarm, so a failed beep is not an error worth raising.
  }
}

export function ring(timer: CookTimer): void {
  beep();
  const api = notificationApi();
  if (!api || api.permission !== "granted") return;
  try {
    new api(`${timer.label} is up`, {
      body: `${timer.recipeTitle}, step ${timer.stepNumber}`,
      tag: timer.id,
    });
  } catch {
    // Some browsers require a service worker registration to construct one. The beep and
    // the strip have already done the job.
  }
}
