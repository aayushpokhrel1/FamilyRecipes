import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import IngredientCatalogPicker from "./IngredientCatalogPicker";

test("adds checked items with the chosen section", () => {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  render(<IngredientCatalogPicker onAdd={onAdd} onClose={onClose} defaultSection="Spices" />);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  fireEvent.click(screen.getByRole("button", { name: /add selected/i }));
  expect(onAdd).toHaveBeenCalledTimes(1);
  const [names, section] = onAdd.mock.calls[0];
  expect(names.length).toBe(1);
  expect(section).toBe("Spices");
  expect(onClose).toHaveBeenCalled();
});

test("search narrows the catalog to nothing for a nonsense query", () => {
  render(<IngredientCatalogPicker onAdd={() => {}} onClose={() => {}} />);
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("search ingredients"), { target: { value: "zzzznotreal" } });
  expect(screen.queryAllByRole("checkbox").length).toBe(0);
});

test("shows one category at a time and keeps checks across a switch", () => {
  const onAdd = vi.fn();
  render(<IngredientCatalogPicker onAdd={onAdd} onClose={() => {}} />);
  // Produce is the default category; Spices items are not rendered yet.
  expect(screen.getByLabelText("onion")).toBeTruthy();
  expect(screen.queryByLabelText("cumin")).toBeNull();

  fireEvent.click(screen.getByLabelText("onion"));
  fireEvent.click(screen.getByRole("button", { name: "Spices" }));
  expect(screen.queryByLabelText("onion")).toBeNull();
  fireEvent.click(screen.getByLabelText("cumin"));

  fireEvent.click(screen.getByRole("button", { name: /add selected/i }));
  expect(onAdd.mock.calls[0][0].sort()).toEqual(["cumin", "onion"]);
});
