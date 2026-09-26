import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("renders with label and description", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Dark Mode" description="Toggle theme" />);

    expect(screen.getByText("Dark Mode")).toBeInTheDocument();
    expect(screen.getByText("Toggle theme")).toBeInTheDocument();
  });

  it("has correct ARIA role", () => {
    render(<Switch checked={false} onChange={vi.fn()} label="Test" />);

    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("reflects checked state in aria-checked", () => {
    render(<Switch checked={true} onChange={vi.fn()} label="Test" />);

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange when clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Test" />);

    await user.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
