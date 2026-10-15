import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armAlarm, resetAlarmForTests, ring } from "./cookAlarm";
import type { CookTimer } from "./cookTimers";

const timer: CookTimer = {
  id: "t1", recipeId: "r1", recipeTitle: "Dal", stepNumber: 2,
  label: "20 minutes", matchIndex: 0, endsAt: Date.now(), ringing: true,
};

let resume: ReturnType<typeof vi.fn>;
let connect: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAlarmForTests();
  resume = vi.fn().mockResolvedValue(undefined);
  connect = vi.fn();
  const osc = { connect, frequency: { value: 0 }, type: "sine", start: vi.fn(), stop: vi.fn() };
  const gain = { connect, gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
  class FakeCtx {
    state = "suspended";
    currentTime = 0;
    destination = {};
    resume = resume;
    createOscillator = vi.fn(() => osc);
    createGain = vi.fn(() => gain);
  }
  vi.stubGlobal("AudioContext", FakeCtx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cookAlarm", () => {
  // The whole reason armAlarm exists. Autoplay policy suppresses audio with no user gesture
  // behind it, SILENTLY. Build the context at ring time and the beep is blocked at exactly
  // the moment it is needed, with no error anywhere.
  it("creates and resumes the audio context on the arming gesture", () => {
    armAlarm();
    expect(resume).toHaveBeenCalled();
  });

  it("beeps when a timer rings", () => {
    armAlarm();
    ring(timer);
    expect(connect).toHaveBeenCalled();
  });

  it("does not throw when AudioContext is unavailable", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(() => armAlarm()).not.toThrow();
    expect(() => ring(timer)).not.toThrow();
  });

  it("asks for notification permission only while it is still unanswered", () => {
    const request = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "default", requestPermission: request }));
    armAlarm();
    expect(request).toHaveBeenCalledTimes(1);

    request.mockClear();
    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "denied", requestPermission: request }));
    armAlarm();
    expect(request).not.toHaveBeenCalled();

    vi.stubGlobal("Notification", Object.assign(vi.fn(), { permission: "granted", requestPermission: request }));
    armAlarm();
    expect(request).not.toHaveBeenCalled();
  });

  it("shows a notification naming the recipe and step when permission was granted", () => {
    const ctor = vi.fn();
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "granted", requestPermission: vi.fn() }));
    ring(timer);
    expect(ctor).toHaveBeenCalled();
    const body = JSON.stringify(ctor.mock.calls[0]);
    expect(body).toContain("Dal");
    expect(body).toContain("20 minutes");
  });

  it("does not throw when Notification is absent, as it is in some embedded browsers", () => {
    vi.stubGlobal("Notification", undefined);
    expect(() => armAlarm()).not.toThrow();
    expect(() => ring(timer)).not.toThrow();
  });
});