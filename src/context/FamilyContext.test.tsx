import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { FamilyProvider, useFamily } from "./FamilyContext";

vi.mock("../lib/api/families", () => ({
  listMyFamilies: vi.fn().mockResolvedValue([
    { id: "f1", name: "Alpha", invite_code: "a", created_by: "u" },
    { id: "f2", name: "Beta", invite_code: "b", created_by: "u" },
  ]),
}));

function Consumer() {
  const { activeFamily } = useFamily();
  return <div>{activeFamily?.name}</div>;
}

test("defaults to the first family after load", async () => {
  render(
    <FamilyProvider>
      <Consumer />
    </FamilyProvider>,
  );
  expect(await screen.findByText("Alpha")).toBeInTheDocument();
});
