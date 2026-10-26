// jsdom implements no speech engine at all, which is exactly the browser this module has to
// survive: the "unavailable" branch is the DEFAULT here, and the available one is the branch
// that needs a stub.
import { afterEach, describe, expect, it, vi } from "vitest";
import { speak, speechAvailable, stopSpeaking } from "./speech";

type Stub = { cancel: ReturnType<typeof vi.fn>; speak: ReturnType<typeof vi.fn> };

function withEngine(): Stub {
  const stub: Stub = { cancel: vi.fn(), speak: vi.fn() };
  vi.stubGlobal("speechSynthesis", stub);
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  });
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("without a speech engine", () => {
  it("reports unavailable rather than throwing", () => {
    expect(speechAvailable()).toBe(false);
  });

  it("speaking and stopping are no-ops, so a caller that forgot to ask cannot crash", () => {
    expect(() => speak("Fry the onion.")).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
  });
});

describe("with a speech engine", () => {
  it("reports available", () => {
    withEngine();
    expect(speechAvailable()).toBe(true);
  });

  it("cancels before it speaks, so the step you left does not finish its sentence", () => {
    const engine = withEngine();
    speak("Fry the onion.");
    expect(engine.cancel).toHaveBeenCalledOnce();
    expect(engine.speak).toHaveBeenCalledOnce();
    // The cancel has to come FIRST. Called the other way round, the new utterance is queued
    // behind the old one and then cancelled with it, which is silence rather than barge-in.
    expect(engine.cancel.mock.invocationCallOrder[0])
      .toBeLessThan(engine.speak.mock.invocationCallOrder[0]);
  });

  it("speaks the text it was given", () => {
    const engine = withEngine();
    speak("Fry the onion.");
    expect((engine.speak.mock.calls[0][0] as { text: string }).text).toBe("Fry the onion.");
  });

  it("says nothing at all for an empty or blank string", () => {
    const engine = withEngine();
    speak("");
    speak("   ");
    expect(engine.speak).not.toHaveBeenCalled();
    // Not even the cancel: a step with no text should not silence a step that is still being
    // read, which is what a bare cancel here would do.
    expect(engine.cancel).not.toHaveBeenCalled();
  });

  it("stopping cancels", () => {
    const engine = withEngine();
    stopSpeaking();
    expect(engine.cancel).toHaveBeenCalledOnce();
  });
});
