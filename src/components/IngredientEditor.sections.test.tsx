import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import IngredientEditor from "./IngredientEditor";
import type { Ingredient } from "../lib/api/types";

const ing = (item: string, section: string | null = null): Ingredient =>
  ({ position: 0, quantity: "", unit: "", item, section });

function groupsOf(select: HTMLSelectElement) {
  return [...select.querySelectorAll("optgroup")].map((g) => [
    g.label,
    [...g.querySelectorAll("option")].map((o) => o.textContent),
  ]);
}

test("a brand new recipe still offers real sections to choose from", () => {
  render(<IngredientEditor items={[ing("rice")]} onChange={() => {}} />);
  const select = screen.getByLabelText("Section for rice") as HTMLSelectElement;
  expect(groupsOf(select)).toEqual([["Common", expect.arrayContaining(["For the marinade", "Garnish"])]]);
});

test("the family's own wording is offered above the common list", () => {
  render(
    <IngredientEditor items={[ing("rice")]} onChange={() => {}}
      sectionSuggestions={["For the tadka"]} />,
  );
  const select = screen.getByLabelText("Section for rice") as HTMLSelectElement;
  const labels = groupsOf(select).map(([label]) => label);
  expect(labels).toEqual(["Your sections", "Common"]);
});

test("a section already used in this recipe is not offered twice", () => {
  render(
    <IngredientEditor items={[ing("rice", "For the sauce"), ing("salt")]} onChange={() => {}}
      sectionSuggestions={["For the sauce"]} />,
  );
  const select = screen.getByLabelText("Section for salt") as HTMLSelectElement;
  const all = [...select.querySelectorAll("option")].map((o) => o.textContent);
  expect(all.filter((t) => t === "For the sauce")).toHaveLength(1);
});

test("picking a suggestion sets it on that row without any typing", () => {
  const onChange = vi.fn();
  render(<IngredientEditor items={[ing("rice")]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Section for rice"), { target: { value: "Garnish" } });
  expect(onChange.mock.calls[0][0][0].section).toBe("Garnish");
});
