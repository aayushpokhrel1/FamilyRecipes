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
