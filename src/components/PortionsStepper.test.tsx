import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import PortionsStepper from "./PortionsStepper";

test("increments servings and reports the scaled factor", () => {
  const onFactor = vi.fn();
  render(<PortionsStepper base={2} onFactorChange={onFactor} />);
  expect(onFactor).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByLabelText("increase"));
  expect(screen.getByLabelText("portions value")).toHaveTextContent("3");
  expect(onFactor).toHaveBeenLastCalledWith(1.5);
});

test("uses a multiplier when base servings is unknown", () => {
  const onFactor = vi.fn();
  render(<PortionsStepper base={null} onFactorChange={onFactor} />);
  expect(onFactor).toHaveBeenLastCalledWith(1);
  fireEvent.click(screen.getByLabelText("increase"));
  expect(onFactor).toHaveBeenLastCalledWith(1.5);
});
