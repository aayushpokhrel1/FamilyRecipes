import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import TagPicker from "./TagPicker";

const listTags = vi.fn();
vi.mock("../lib/api/tags", () => ({
  listTags: (...a: any[]) => listTags(...a),
  ensureTag: vi.fn(),
}));

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, family_id: "f1", name: `tag${i}` }));

beforeEach(() => vi.clearAllMocks());

test("a short tag list gets no filter box, which would just be another box in the way", async () => {
  listTags.mockResolvedValue(many(5));
  render(<TagPicker familyId="f1" value={[]} onChange={() => {}} />);
  expect(await screen.findByRole("button", { name: "tag0" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /filter tags/i })).toBeNull();
});

test("a long tag list gets a filter box that narrows the row", async () => {
  listTags.mockResolvedValue(many(20));
  render(<TagPicker familyId="f1" value={[]} onChange={() => {}} />);
  const filter = await screen.findByRole("textbox", { name: /filter tags/i });

  await userEvent.type(filter, "tag19");
  await waitFor(() => expect(screen.queryByRole("button", { name: "tag0" })).toBeNull());
  expect(screen.getByRole("button", { name: "tag19" })).toBeInTheDocument();
});

// Hiding a ticked tag makes it look unticked, and you cannot untick what you cannot see.
test("a selected tag stays visible even when it does not match the filter", async () => {
  listTags.mockResolvedValue(many(20));
  render(<TagPicker familyId="f1" value={["t0"]} onChange={() => {}} />);
  const filter = await screen.findByRole("textbox", { name: /filter tags/i });

  await userEvent.type(filter, "tag19");
  const kept = screen.getByRole("button", { name: "tag0" });
  expect(kept).toBeInTheDocument();
  expect(kept).toHaveAttribute("aria-pressed", "true");
});

test("a filter that matches nothing says so rather than showing an empty gap", async () => {
  listTags.mockResolvedValue(many(20));
  render(<TagPicker familyId="f1" value={[]} onChange={() => {}} />);
  await userEvent.type(await screen.findByRole("textbox", { name: /filter tags/i }), "zzz");
  expect(await screen.findByText(/no tag matches/i)).toBeInTheDocument();
});
