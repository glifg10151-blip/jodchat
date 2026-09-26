import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "./Modal";
import { ImagePreviewModal } from "./ImagePreviewModal";

vi.mock("../../store/useKeybindStore", () => ({
  matchKeybind: () => false,
  useKeybindStore: () => ({
    keybinds: {
      prevImage: { currentCombo: "ArrowLeft" },
      nextImage: { currentCombo: "ArrowRight" },
    },
  }),
}));

async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe.run(container);
  expect(results.violations).toEqual([]);
}

describe("dialog accessibility", () => {
  it("keeps confirmation dialogs free of detectable axe violations", async () => {
    const { container } = render(
      <ConfirmModal
        isOpen
        title="Delete item?"
        message="This cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it("provides complete image-preview dialog semantics", async () => {
    const { container } = render(
      <ImagePreviewModal
        isOpen
        onClose={vi.fn()}
        images={[{ url: "data:image/png;base64,AA==", name: "Example image" }]}
        activeIndex={0}
        onChangeActiveIndex={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
