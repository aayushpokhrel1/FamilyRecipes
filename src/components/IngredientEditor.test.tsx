import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import IngredientEditor from "./IngredientEditor";
import type { Ingredient } from "../lib/api/types";
function Harness() {
  const [items, setItems] = useState<Ingredient[]>([]);
  return <IngredientEditor items={items} onChange={setItems} />;
}
test("adds an ingredient row", async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
  expect(screen.getAllByPlaceholderText(/item/i)).toHaveLength(1);
});

function Seeded({ initial }: { initial: Ingredient[] }) {
  const [items, setItems] = useState<Ingredient[]>(initial);
  return <IngredientEditor items={items} onChange={setItems} />;
}

test("ticking Optional marks that ingredient optional", async () => {
  render(<Seeded initial={[
    { position: 0, quantity: "", unit: "", item: "cream" },
    { position: 1, quantity: "", unit: "", item: "yogurt" },
  ]} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /optional for cream/i }));
  expect(screen.getByRole("checkbox", { name: /optional for cream/i })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /optional for yogurt/i })).not.toBeChecked();
});

test("choosing an alternative target gives both rows the same alt_group", async () => {
  render(<Seeded initial={[
    { position: 0, quantity: "", unit: "", item: "cream" },
    { position: 1, quantity: "", unit: "", item: "yogurt" },
  ]} />);
  // selectOptions matches an option by its VALUE, and the values are row indices, not names.
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: /alternative to for yogurt/i }),
    "0",
  );
  const cream = screen.getByRole("combobox", { name: /alternative to for cream/i });
  const yogurt = screen.getByRole("combobox", { name: /alternative to for yogurt/i });
  // cream is the primary, so it is not an alternative to anything
  expect(cream).toHaveValue("");
  // yogurt now points at cream
  expect(yogurt).toHaveValue("0");
});

test("choosing the blank option clears this row's alt_group", async () => {
  // BOTH rows carry the group: a lone alt_group makes that row its own primary, which
  // correctly shows blank, so seeding only yogurt would be testing the wrong state.
  render(<Seeded initial={[
    { position: 0, quantity: "", unit: "", item: "cream", alt_group: "g1" },
    { position: 1, quantity: "", unit: "", item: "yogurt", alt_group: "g1" },
  ]} />);
  const yogurt = screen.getByRole("combobox", { name: /alternative to for yogurt/i });
  expect(yogurt).toHaveValue("0");
  await userEvent.selectOptions(yogurt, "");
  expect(screen.getByRole("combobox", { name: /alternative to for yogurt/i })).toHaveValue("");
});

test("an ingredient is never listed as an alternative option for itself", async () => {
  render(<Seeded initial={[
    { position: 0, quantity: "", unit: "", item: "cream" },
    { position: 1, quantity: "", unit: "", item: "yogurt" },
  ]} />);
  const yogurt = screen.getByRole("combobox", { name: /alternative to for yogurt/i });
  const options = Array.from(yogurt.querySelectorAll("option")).map((o) => o.textContent);
  expect(options).not.toContain("yogurt");
  expect(options).toContain("cream");
});
