import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelCard } from "./ModelCard";
import type { ModelConfig } from "../../../types";

const model: ModelConfig = {
  id: "model-1",
  name: "New Model",
  apiBase: "https://example.com/v1/chat/completions",
  apiKey: "",
  modelId: "example-model",
  provider: "custom",
  enabled: true,
};

describe("ModelCard", () => {
  it("uses the themed provider listbox and applies the selected preset", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(<ModelCard model={model} onUpdate={onUpdate} onDelete={vi.fn()} connectionStatus="disconnected" />);

    await user.click(screen.getByRole("button", { name: "Provider Preset" }));
    expect(screen.getByRole("listbox", { name: "Provider Preset" })).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: "OpenAI" }));

    expect(onUpdate).toHaveBeenCalledWith("model-1", {
      provider: "openai",
      apiBase: "https://api.openai.com/v1/chat/completions",
      modelId: "gpt-5.6-sol",
      name: "GPT 5.6 Sol",
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("automatically generates model name when changing Model ID", () => {
    const onUpdate = vi.fn();

    render(
      <ModelCard
        model={{ ...model, modelId: "example-model", name: "Example Model" }}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        connectionStatus="disconnected"
      />,
    );

    const modelIdInput = screen.getByLabelText("Model ID");
    fireEvent.change(modelIdInput, { target: { value: "z-ai/glm-5.2" } });

    expect(onUpdate).toHaveBeenCalledWith("model-1", {
      modelId: "z-ai/glm-5.2",
      name: "GLM 5.2",
    });
  });

  it("allows manual regeneration via the auto-generate button", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();

    render(
      <ModelCard
        model={{ ...model, modelId: "meta/llama-3.3-70b-instruct", name: "Custom Name" }}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        connectionStatus="disconnected"
      />,
    );

    const autoGenBtn = screen.getByRole("button", { name: /generate name from model id/i });
    await user.click(autoGenBtn);

    expect(onUpdate).toHaveBeenCalledWith("model-1", {
      name: "Llama 3.3 70B Instruct",
    });
  });

  it("shows a compact status when an API key is already configured", () => {
    render(
      <ModelCard
        model={{ ...model, apiKey: "••••••••••••" }}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        connectionStatus="disconnected"
      />,
    );

    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show api key/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "Enter a new key to replace");
  });

  it("does not require an API key for a custom endpoint", () => {
    render(<ModelCard model={model} onUpdate={vi.fn()} onDelete={vi.fn()} connectionStatus="disconnected" />);

    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "API Key (optional)");
    expect(screen.queryByText("API key is required for this provider")).not.toBeInTheDocument();
  });
});
