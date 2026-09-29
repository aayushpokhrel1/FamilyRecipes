import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi } from "vitest";
import RecipeCard from "./RecipeCard";

const recipe: any = {
  id: "r1", family_id: "f1", author_id: "u1", title: "Dal", story: null, provenance: null,
  servings: 2, prep_minutes: null, cook_minutes: null, visibility: "public",
  source_url: null, created_at: "", updated_at: "",
  source_recipe_id: null, source_cook_name: null, adapted_at: null,
  removed_at: null, removed_reason: null,
};

const draw = (props: any = {}) =>
  render(<MemoryRouter><ul><RecipeCard recipe={recipe} {...props} /></ul></MemoryRouter>);

// RecipeList passes no onSave, so the vault grid must be untouched by this change.
test("no save button unless onSave is given", () => {
  draw();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

// A grid of buttons all named "Save" is unusable with a screen reader.
test("the button names the recipe it saves", async () => {
  const onSave = vi.fn();
  draw({ onSave });
  const btn = screen.getByRole("button", { name: /save dal to my vault/i });
  await userEvent.click(btn);
  expect(onSave).toHaveBeenCalledTimes(1);
});

test("an already saved card says so and cannot be clicked again", async () => {
  const onSave = vi.fn();
  draw({ onSave, saved: true });
  const btn = screen.getByRole("button", { name: /in your vault/i });
  expect(btn).toBeDisabled();
  await userEvent.click(btn);
  expect(onSave).not.toHaveBeenCalled();
});

// A button inside an anchor is invalid HTML and steals the card's click target. The card
// comment records the other half of this: a sibling in normal FLOW became its own grid
// cell, which is why the button is positioned out of flow instead.
test("the button is not inside the card's link", () => {
  draw({ onSave: vi.fn() });
  const link = screen.getByRole("link");
  expect(link.querySelector("button")).toBeNull();
});
