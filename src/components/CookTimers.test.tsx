import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CookTimers from "./CookTimers";
import * as timers from "../lib/cookTimers";

beforeEach(() => {
  localStorage.clear();
  timers.resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

const seed = { recipeId: "r1", recipeTitle: "Dal", stepNumber: 2, label: "20 minutes", matchIndex: 0 };

describe("CookTimers", () => {
  // REVIEW FOCUS 4. AppLayout wraps the four public documents and the public recipe page, so
  // this renders with no session and no active family. It must read neither.
  it("renders nothing at all when no timer is running", () => {
    const { container } = render(<CookTimers />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a running timer with its recipe, step and remaining time", () => {
    act(() => {
      timers.start({ ...seed, seconds: 150 });
    });
    render(<CookTimers />);
    expect(screen.getByText(/Dal/)).toBeInTheDocument();
    expect(screen.getByText(/step 2/i)).toBeInTheDocument();
    expect(screen.getByText("2:30")).toBeInTheDocument();
  });

  it("offers cancel while running and dismiss once ringing", async () => {
    const user = userEvent.setup();
    act(() => {
      timers.start({ ...seed, seconds: 150 });
    });
    render(<CookTimers />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(timers.list()).toHaveLength(0);
  });

  it("announces a ringing timer to a screen reader and clears it on dismiss", async () => {
    const user = userEvent.setup();
    act(() => {
      const t = timers.start({ ...seed, seconds: 1 });
      // Ring it directly rather than waiting a second of real time.
      timers.resetForTests();
      localStorage.setItem("cookTimers", JSON.stringify([{ ...t, endsAt: Date.now() - 1000 }]));
      timers.resetForTests();
    });
    render(<CookTimers />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(timers.list()).toHaveLength(0);
  });

  it("updates as the clock runs", () => {
    vi.useFakeTimers();
    act(() => {
      timers.start({ ...seed, seconds: 150 });
    });
    render(<CookTimers />);
    expect(screen.getByText("2:30")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText("2:20")).toBeInTheDocument();
  });
});
