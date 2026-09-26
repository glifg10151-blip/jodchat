import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImagePreviewModal } from "./ImagePreviewModal";

const image = {
  url: "data:image/png;base64,iVBORw0KGgo=",
  name: "appshot.png",
  size: 1024,
};

describe("ImagePreviewModal", () => {
  it("escapes clipped app containers and restores the background when closed", () => {
    const { container, unmount } = render(
      <div style={{ transform: "translateZ(0)", overflow: "hidden" }}>
        <ImagePreviewModal isOpen onClose={vi.fn()} images={[image]} activeIndex={0} onChangeActiveIndex={vi.fn()} />
      </div>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    expect(container).toHaveAttribute("aria-hidden", "true");

    unmount();
    expect(document.body).not.toContainElement(dialog);
    expect(container).not.toHaveAttribute("aria-hidden");
  });

  it("applies zoom button changes to the rendered image", async () => {
    const user = userEvent.setup();

    render(
      <ImagePreviewModal isOpen onClose={vi.fn()} images={[image]} activeIndex={0} onChangeActiveIndex={vi.fn()} />,
    );

    const preview = screen.getByAltText("appshot.png");

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });

    await user.click(screen.getByTitle("Zoom In"));

    expect(screen.getByText("125%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1.25)" });

    await user.click(screen.getByTitle("Zoom Out"));

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(preview).toHaveStyle({ transform: "translate(0px, 0px) scale(1)" });
  });
});
