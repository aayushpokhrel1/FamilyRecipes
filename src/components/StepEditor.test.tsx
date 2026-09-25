import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import StepEditor from "./StepEditor";
import type { Step } from "../lib/api/types";

vi.mock("../lib/api/extract", () => ({
  extractRecipe: vi.fn(),
}));

const step = (text: string, position = 0): Step => ({ position, text });

function box() {
  return screen.getByPlaceholderText(/one step per line/i) as HTMLTextAreaElement;
}

test("existing steps render as lines in the textarea", () => {
  render(<StepEditor items={[step("Boil the water", 0), step("Add the rice", 1)]} onChange={() => {}} />);
  expect(box().value).toBe("Boil the water\nAdd the rice");
});

test("typing three lines calls onChange with three steps, positions 0,1,2", () => {
  const onChange = vi.fn();
  render(<StepEditor items={[]} onChange={onChange} />);
  fireEvent.change(box(), { target: { value: "One\nTwo\nThree" } });
  expect(onChange).toHaveBeenCalledWith([
    { position: 0, text: "One" },
    { position: 1, text: "Two" },
    { position: 2, text: "Three" },
  ]);
});

test("blank lines and whitespace-only lines do not become steps", () => {
  const onChange = vi.fn();
  render(<StepEditor items={[]} onChange={onChange} />);
  fireEvent.change(box(), { target: { value: "One\n\n   \nTwo\n" } });
  expect(onChange).toHaveBeenCalledWith([
    { position: 0, text: "One" },
    { position: 1, text: "Two" },
  ]);
});

test("a parent replacing items updates the textarea", () => {
  const { rerender } = render(<StepEditor items={[step("Old step")]} onChange={() => {}} />);
  expect(box().value).toBe("Old step");
  rerender(<StepEditor items={[step("Fresh step", 0), step("Second", 1)]} onChange={() => {}} />);
  expect(box().value).toBe("Fresh step\nSecond");
});

test("Tidy into steps replaces the content with the model's steps", async () => {
  const { extractRecipe } = await import("../lib/api/extract");
  (extractRecipe as any).mockResolvedValue({
    title: "ignored",
    story: "",
    provenance: "",
    servings: null,
    prep_minutes: null,
    cook_minutes: null,
    ingredients: [],
    steps: [step("Heat the pan", 0), step("Fry the onions", 1)],
    source_url: null,
  });
  const onChange = vi.fn();
  render(<StepEditor items={[step("a long pasted paragraph")]} onChange={onChange} />);
  await userEvent.click(screen.getByRole("button", { name: /tidy into steps/i }));
  await waitFor(() => expect(box().value).toBe("Heat the pan\nFry the onions"));
  expect(extractRecipe).toHaveBeenCalledWith("text", "a long pasted paragraph");
  expect(onChange).toHaveBeenLastCalledWith([
    { position: 0, text: "Heat the pan" },
    { position: 1, text: "Fry the onions" },
  ]);
});

test("no mic button when recording is unsupported", () => {
  render(<StepEditor items={[step("Boil the water")]} onChange={() => {}} />);
  expect(screen.queryByRole("button", { name: /speak|record|mic/i })).toBeNull();
});
