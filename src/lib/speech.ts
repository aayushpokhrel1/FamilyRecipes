// The browser's own speech engine, wrapped so the rest of the app never touches it directly.
//
// No permission prompt and no network: `speechSynthesis` is the one hands-free-ish API that
// costs nothing to use, which is why Cook Mode reads steps aloud and still does not listen.
//
// IT IS NOT EVERYWHERE, and the absence is silent. A browser without it has no
// `window.speechSynthesis` at all, and calling into it would throw on the first tap. Every
// caller therefore asks `speechAvailable()` FIRST and draws no control when it says no: a
// button that does nothing is worse than no button, and this project has shipped that mistake
// before with a class name that did not exist.
export function speechAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

// CANCEL BEFORE SPEAKING, ALWAYS, and that is the barge-in rule rather than tidiness. The
// engine queues: without the cancel, tapping through three steps reads all three in turn and
// the voice falls further behind the screen with every tap. The step you have left must not
// finish its sentence.
export function speak(text: string): void {
  if (!speechAvailable()) return;
  const spoken = text.trim();
  if (!spoken) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new window.SpeechSynthesisUtterance(spoken));
}

export function stopSpeaking(): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.cancel();
}
