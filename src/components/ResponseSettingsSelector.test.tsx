import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResponseSettingsSelector } from "./ResponseSettingsSelector";
import type { ModelConfig, ModelStatuses } from "../types";

const models: ModelConfig[] = [
  {
    id: "model-1",
    name: "GPT-5",
    apiBase: "https://api.openai.com/v1/chat/completions",
    apiKey: "sk-test",
    modelId: "gpt-5",
    provider: "OpenAI",
  },
  {
    id: "model-2",
    name: "Llama 3",
    apiBase: "http://localhost:11434/v1/chat/completions",
    apiKey: "",
    modelId: "llama3.1",
    provider: "Ollama (Local)",
  },
];

const modelStatuses: ModelStatuses = {
  "model-1": "connected",
  "model-2": "disconnected",
};

function makeRect(left: number, width: number): DOMRect {
  return {
    bottom: 100,
    height: 100,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

describe("ResponseSettingsSelector", () => {
  it("opens a padded, centered panel below comparison triggers and changes models", async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();

    render(
      <ResponseSettingsSelector
        models={models}
        selectedModel="model-1"
        onModelChange={onModelChange}
        modelStatuses={modelStatuses}
        placement="below"
      />,
    );

    const trigger = screen.getByRole("button", { name: /response settings/i });
    expect(trigger).not.toHaveTextContent("·");
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /model and thinking settings/i });
    expect(dialog).toHaveClass("right-0", "top-full", "p-1.5", "font-normal");

    const modelMenuButton = screen.getByRole("button", { name: /^model/i });
    await user.hover(modelMenuButton);
    expect(modelMenuButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("group", { name: "Model options" })).toHaveClass("left-full", "-ml-px");
    await user.click(screen.getByRole("button", { name: "Llama 3" }));

    expect(onModelChange).toHaveBeenCalledWith("model-2");
    expect(modelMenuButton).toHaveFocus();
  });

  it("allows comparison flyouts to use space beyond their own column", async () => {
    const user = userEvent.setup();

    render(
      <div className="comparison-column-panel" data-testid="comparison-column">
        <ResponseSettingsSelector
          models={models}
          selectedModel="model-1"
          onModelChange={vi.fn()}
          modelStatuses={modelStatuses}
          placement="below"
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));

    const dialog = screen.getByRole("dialog", { name: /model and thinking settings/i });
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(makeRect(300, 184));
    vi.spyOn(screen.getByTestId("comparison-column"), "getBoundingClientRect").mockReturnValue(makeRect(0, 400));

    await user.hover(screen.getByRole("button", { name: /^model/i }));

    expect(screen.getByRole("group", { name: "Model options" })).toHaveClass("left-full", "-ml-px");
  });

  it("opens comparison flyouts left when the app viewport has insufficient right-side space", async () => {
    const user = userEvent.setup();

    render(
      <ResponseSettingsSelector
        models={models}
        selectedModel="model-1"
        onModelChange={vi.fn()}
        modelStatuses={modelStatuses}
        placement="below"
      />,
    );

    await user.click(screen.getByRole("button", { name: /response settings/i }));

    const dialog = screen.getByRole("dialog", { name: /model and thinking settings/i });
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue(makeRect(300, 184));
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(400);

    await user.hover(screen.getByRole("button", { name: /^model/i }));

    expect(screen.getByRole("group", { name: "Model options" })).toHaveClass("right-full", "-mr-px");
  });
});
