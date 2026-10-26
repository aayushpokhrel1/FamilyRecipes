import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi } from "vitest";
import CookMode from "./CookMode";
import { getRecipe } from "../lib/api/recipes";
import * as timers from "../lib/cookTimers";

const family = vi.hoisted(() => ({
  active: { id: "f1", name: "F", invite_code: "x", created_by: "u" } as
    { id: string; name: string; invite_code: string; created_by: string } | null,
}));

vi.mock("../context/FamilyContext", () => ({
  useFamily: () => ({ activeFamily: family.active }),
}));

vi.mock("../lib/api/recipes", () => ({
  getRecipe: vi.fn().mockResolvedValue({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [
      { position: 0, text: "mix well" },
      { position: 1, text: "bake it" },
    ],
    photos: [],
  }),
}));

vi.mock("../lib/api/cookLog", () => ({
  logCooked: vi.fn().mockResolvedValue({}),
}));

vi.mock("../lib/api/pantry", () => ({
  listPantry: vi.fn().mockResolvedValue([]),
  setState: vi.fn().mockResolvedValue(undefined),
}));

function renderCookMode(entry = "/recipes/r1/cook") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/recipes/:id/cook" element={<CookMode />} />
      </Routes>
    </MemoryRouter>,
  );
}

test("advances through steps with the Next button", async () => {
  renderCookMode();
  expect(await screen.findByText("mix well")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("marking as cooked logs once and is not offered again", async () => {
  const cl = await import("../lib/api/cookLog");
  renderCookMode();
  const button = await screen.findByRole("button", { name: /mark as cooked/i });
  await userEvent.click(button);
  expect(cl.logCooked).toHaveBeenCalledWith("f1", "r1");
  expect(await screen.findByRole("status")).toHaveTextContent("Logged. Nice one.");
  expect(screen.queryByRole("button", { name: /mark as cooked/i })).not.toBeInTheDocument();
});

test("marking as cooked is disabled without an active family", async () => {
  family.active = null;
  renderCookMode();
  expect(await screen.findByRole("button", { name: /mark as cooked/i })).toBeDisabled();
  family.active = { id: "f1", name: "F", invite_code: "x", created_by: "u" };
});

// A family recipe is often just an ingredient list with no method written down.
// Mark as cooked used to live inside the steps block, so for those recipes the
// cook log was unreachable: the button simply did not exist. Found in the
// browser, not here, because every fixture above happens to have steps.
test("offers Mark as cooked even when the recipe has no steps", async () => {
  const recipes = await import("../lib/api/recipes");
  const base = await (recipes.getRecipe as any).mock.results[0]?.value;
  (recipes.getRecipe as any).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: base?.ingredients ?? [],
    steps: [],
    photos: [],
  });
  renderCookMode();
  expect(await screen.findByText("No steps yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as cooked" })).toBeInTheDocument();
});

test("after marking cooked, offers only the cupboard items that recipe used", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([
    { id: "p1", key: "rice", label: "Rice", kind: "keep", state: "have", expires_on: null },
    { id: "p2", key: "saffron", label: "Saffron", kind: "keep", state: "have", expires_on: null },
  ]);
  const recipes = await import("../lib/api/recipes");
  (recipes.getRecipe as any).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "Rice" }],
    steps: [{ position: 0, text: "mix well" }],
    photos: [],
  });
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByRole("button", { name: /Rice.*out/i })).toBeInTheDocument();
  // Saffron is in the cupboard but not in this recipe, so it is not offered.
  expect(screen.queryByRole("button", { name: /Saffron/i })).not.toBeInTheDocument();
});

// A recipe whose ingredients are all unknown to the cupboard must not render
// an empty prompt with nothing in it.
test("skips the prompt when the recipe used nothing in the cupboard", async () => {
  const pantry = await import("../lib/api/pantry");
  (pantry.listPantry as any).mockResolvedValue([]);
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as cooked" }));
  expect(await screen.findByText(/Logged/i)).toBeInTheDocument();
  expect(screen.queryByText(/Used anything up/i)).not.toBeInTheDocument();
});

// ---------------------------------------------------------------- the rework ----
// The step index is in the URL, the step itself advances, this step's ingredients sit under
// it, and an ingredient can be ticked off as you add it. Spec:
// docs/superpowers/specs/2026-10-15-cook-mode-design.md

test("the step itself advances, so a knuckle will do", async () => {
  renderCookMode();
  const step = await screen.findByRole("button", { name: /advance from step 1 of 2/i });
  await userEvent.click(step);
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("the last step's tap target does nothing rather than wrapping round", async () => {
  renderCookMode("/recipes/r1/cook?step=2");
  const step = await screen.findByRole("button", { name: /advance from step 2 of 2/i });
  expect(step).toBeDisabled();
});

// A URL is editable input, so it is a trust boundary like any other.
test("a step number out of range or not a number clamps instead of blanking", async () => {
  renderCookMode("/recipes/r1/cook?step=99");
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("a nonsense step number falls back to the first step", async () => {
  renderCookMode("/recipes/r1/cook?step=abc");
  expect(await screen.findByText("mix well")).toBeInTheDocument();
});

test("opening at ?step=2 starts on the second step", async () => {
  renderCookMode("/recipes/r1/cook?step=2");
  expect(await screen.findByText("bake it")).toBeInTheDocument();
});

test("a step that names no ingredient shows no inline list", async () => {
  renderCookMode();
  await screen.findByText("mix well");
  // "mix well" mentions no ingredient, and a wrong one is worse than none.
  expect(screen.queryByRole("button", { name: /flour/i })).toBeNull();
});

test("an ingredient the step mentions is shown under it and can be ticked off", async () => {
  const recipes = await import("../lib/api/recipes");
  (recipes.getRecipe as any).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [{ position: 0, quantity: "1", unit: "cup", item: "flour" }],
    steps: [{ position: 0, text: "sift the flour" }, { position: 1, text: "bake it" }],
    photos: [],
  });
  renderCookMode();
  await screen.findByText("sift the flour");

  const tick = screen.getByRole("button", { name: /1 cup flour/i });
  expect(tick).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(tick);
  expect(screen.getByRole("button", { name: /1 cup flour/i })).toHaveAttribute("aria-pressed", "true");
});

// The spec's layout rule, and the bug this whole rework started from: the panel used to
// render ABOVE the step and push it off the bottom of a phone. jsdom does no grid layout, so
// "beside" cannot be measured here; what CAN be pinned is the half that makes "below" true on
// a narrow screen, which is DOM order. Verified visually at 375px and 1024px as well.
test("the ingredient panel comes after the step, never before it", async () => {
  renderCookMode();
  await screen.findByText("mix well");
  await userEvent.click(screen.getByRole("button", { name: /show ingredients/i }));

  const body = document.querySelector(".cook-body")!;
  const main = body.querySelector(".cook-main")!;
  const aside = body.querySelector(".cook-aside")!;
  expect(main).toBeTruthy();
  expect(aside).toBeTruthy();
  expect(main.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

// A recipe whose steps you choose, queued for the next render only. The module-level mock
// above has no duration in either step, which is right for the other tests and useless here.
function mockSteps(...texts: string[]) {
  vi.mocked(getRecipe).mockResolvedValueOnce({
    recipe: {
      id: "r1", family_id: "f1", author_id: "u", title: "Dal",
      story: null, provenance: null, servings: 2, prep_minutes: null,
      cook_minutes: null, visibility: "family", source_url: null,
      created_at: "", updated_at: "",
    },
    ingredients: [],
    steps: texts.map((text, i) => ({ position: i, text })),
    photos: [],
  } as never);
}

beforeEach(() => {
  localStorage.clear();
  timers.resetForTests();
});

test("offers a timer chip for each duration in the step", async () => {
  mockSteps("Simmer for 20 minutes, then rest 45 seconds.");
  renderCookMode();
  expect(await screen.findByRole("button", { name: /start a 20 minutes timer/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start a 45 seconds timer/i })).toBeInTheDocument();
});

test("offers no chip for a step with no duration", async () => {
  mockSteps("Chop the onions finely.");
  renderCookMode();
  expect(await screen.findByText("Chop the onions finely.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /timer/i })).not.toBeInTheDocument();
});

test("tapping a chip starts a timer carrying the recipe and step", async () => {
  mockSteps("Simmer for 20 minutes.");
  renderCookMode();
  await userEvent.click(await screen.findByRole("button", { name: /start a 20 minutes timer/i }));
  expect(timers.list()).toHaveLength(1);
  expect(timers.list()[0].label).toBe("20 minutes");
  expect(timers.list()[0].stepNumber).toBe(1);
  expect(timers.list()[0].recipeTitle).toBe("Dal");
});

// Two identical labels in ONE step. This is why a timer's identity carries the parser's
// match index and not just the recipe, the step and the label: starting one of them must
// not mark the other as already running.
test("keeps two identical durations in one step as two separate chips", async () => {
  mockSteps("Fry 5 minutes, then rest 5 minutes.");
  renderCookMode();
  const chips = await screen.findAllByRole("button", { name: /start a 5 minutes timer/i });
  expect(chips).toHaveLength(2);
  await userEvent.click(chips[0]);
  expect(timers.list()).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: /start a 5 minutes timer/i })).toHaveLength(1);
  expect(screen.getByText(/5 minutes, running/i)).toBeInTheDocument();
});

// The step text is itself the Next control, so a chip inside it would nest interactive
// elements and make the step unreliable to tap.
test("keeps the chips outside the step button", async () => {
  mockSteps("Simmer for 20 minutes.");
  renderCookMode();
  const chip = await screen.findByRole("button", { name: /start a 20 minutes timer/i });
  const step = screen.getByRole("button", { name: /advance from step 1/i });
  expect(step).not.toContainElement(chip);
});

// READ ALOUD, AND THE PART WORTH TESTING IS THE WIRING, not the wording: stepSpeech and the
// speech wrapper have their own tests next door. What can only break here is the switch being
// drawn when there is no engine, or the step changing without the voice following it.
//
// jsdom has no speechSynthesis, which is also the real "browser without it" case, so the
// absence is the default and the engine is the thing that has to be stubbed in.
function stubEngine() {
  const engine = { cancel: vi.fn(), speak: vi.fn() };
  vi.stubGlobal("speechSynthesis", engine);
  vi.stubGlobal("SpeechSynthesisUtterance", class {
    text: string;
    constructor(text: string) { this.text = text; }
  });
  return engine;
}

function spokenTexts(engine: { speak: ReturnType<typeof vi.fn> }): string[] {
  return engine.speak.mock.calls.map((c) => (c[0] as { text: string }).text);
}

test("offers no read-aloud switch in a browser with no speech engine", async () => {
  vi.unstubAllGlobals();
  renderCookMode();
  expect(await screen.findByText("mix well")).toBeInTheDocument();
  // A button that silently does nothing is worse than no button.
  expect(screen.queryByRole("button", { name: /read aloud/i })).not.toBeInTheDocument();
});

test("reads the step and its scaled ingredients aloud, and follows the step you move to", async () => {
  const engine = stubEngine();
  renderCookMode();
  await screen.findByText("mix well");
  // Silent until asked.
  expect(engine.speak).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /read aloud/i }));
  // Turning it on reads the step you are ALREADY on, rather than waiting for the next one.
  expect(spokenTexts(engine)).toEqual(["mix well."]);

  await userEvent.click(screen.getByRole("button", { name: /next/i }));
  await screen.findByText("bake it");
  expect(spokenTexts(engine)[1]).toBe("bake it.");

  await userEvent.click(screen.getByRole("button", { name: /reading aloud/i }));
  // Switching off stops it mid-sentence rather than letting the step finish.
  expect(engine.cancel).toHaveBeenCalled();
  const after = engine.speak.mock.calls.length;
  await userEvent.click(screen.getByRole("button", { name: /previous/i }));
  expect(engine.speak.mock.calls.length).toBe(after);
  vi.unstubAllGlobals();
});
