import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import CommentThread from "./CommentThread";

// comments_read (0021) admits every member of the family through can_read_recipe_privately;
// comments_delete (0003) admits the AUTHOR alone. That is read wider than write, which is the
// shape that keeps producing the same bug in this app: the Delete button was rendered on every
// comment in the thread, and a delete row-level security refuses is not an error. It matches no
// rows and resolves, so pressing it on a relative's comment did nothing at all and the thread
// redrew with the comment still in it.
//
// There was no test file for this component before. The recipe page and the meal plan page had
// both already made this mistake, so a third instance is a test rather than a third comment.
const viewer = { userId: "me" };
vi.mock("../context/AuthContext", () => ({ useAuth: () => viewer }));

const listComments = vi.fn();
const deleteComment = vi.fn();
vi.mock("../lib/api/comments", () => ({
  listComments: (...a: unknown[]) => listComments(...a),
  deleteComment: (...a: unknown[]) => deleteComment(...a),
  addComment: vi.fn(),
}));

const comment = (id: string, author_id: string, body: string) => ({
  id,
  recipe_id: "r1",
  author_id,
  body,
  created_at: "2026-10-13",
  profiles: { display_name: author_id === "me" ? "Me" : "A relative" },
});

beforeEach(() => {
  listComments.mockResolvedValue([
    comment("c1", "me", "mine"),
    comment("c2", "someone-else", "theirs"),
  ]);
  deleteComment.mockReset();
});

test("offers Delete on your own comment and not on anyone else's", async () => {
  render(<CommentThread recipeId="r1" />);

  // Both comments are READABLE, which is the point: the thread is the family's.
  expect(await screen.findByText("mine")).toBeInTheDocument();
  expect(screen.getByText("theirs")).toBeInTheDocument();

  // And exactly one Delete, on the one the viewer wrote.
  const deletes = screen.getAllByRole("button", { name: /delete/i });
  expect(deletes).toHaveLength(1);
  // It belongs to the viewer's own comment: same list item.
  expect(deletes[0].closest("li")).toHaveTextContent("mine");
});

test("offers no Delete at all to a signed-out reader", async () => {
  viewer.userId = null as unknown as string;
  try {
    render(<CommentThread recipeId="r1" />);
    await waitFor(() => expect(screen.getByText("mine")).toBeInTheDocument());
    // A null viewer must not match a null author_id either, which is why the comparison is
    // against the comment's author and not merely "is anyone signed in".
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  } finally {
    viewer.userId = "me";
  }
});

// THE RAW TIMESTAMP SHIPPED, and it shipped because every test here asked about buttons.
// "2026-10-27T02:34:18.858908+00:00" sat under every comment in the app until a browser walk
// on 2026-10-26 looked at one. created_at is a string whether it is formatted or not, so
// nothing could fail.
test("shows a readable date rather than the database's timestamp", async () => {
  listComments.mockResolvedValue([
    { ...comment("c1", "me", "Lovely"), created_at: "2026-10-27T02:34:18.858908+00:00" },
  ]);
  render(<CommentThread recipeId="r1" />);
  expect(await screen.findByText("Lovely")).toBeInTheDocument();
  expect(screen.queryByText(/2026-10-27T02:34/)).not.toBeInTheDocument();
  // The year is the stable part of any locale's rendering of that instant; the month and day
  // move with the reader's timezone, which is correct and is why they are not asserted.
  expect(screen.getByText(/2026/)).toBeInTheDocument();
});
