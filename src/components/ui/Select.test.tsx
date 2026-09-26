import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select } from "./Select";

const options = [
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
  { value: "three", label: "Three" },
];

describe("Select", () => {
  it("selects an option with the keyboard and restores trigger focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select value="one" options={options} onChange={onChange} aria-label="Number" />);

    const trigger = screen.getByRole("button", { name: "Number" });
    expect(trigger).toHaveClass("h-10");
    await user.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Number" });
    expect(listbox).toHaveFocus();
    expect(listbox).toHaveClass("popup-surface");

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledWith("two");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("supports Home, End, and Escape without changing the value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select value="two" options={options} onChange={onChange} aria-label="Number" />);

    const trigger = screen.getByRole("button", { name: "Number" });
    trigger.focus();
    await user.keyboard("{ArrowDown}{End}{Escape}");

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("portals compact menus outside clipping containers", async () => {
    const user = userEvent.setup();
    render(
      <div className="overflow-hidden">
        <Select value="one" options={options} onChange={vi.fn()} size="compact" aria-label="Compact number" />
      </div>,
    );

    const trigger = screen.getByRole("button", { name: "Compact number" });
    await user.click(trigger);

    const listbox = screen.getByRole("listbox", { name: "Compact number" });
    expect(listbox.parentElement).toBe(document.body);
    expect(trigger).toHaveClass("text-xs");
    expect(screen.getByRole("option", { name: "One" })).toHaveClass("text-xs");
  });
});
