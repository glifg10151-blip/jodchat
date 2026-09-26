import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import type { FetchApiConfig, SearchApiConfig } from "../../../types";
import { FetchApiCard } from "./FetchApiCard";
import { SearchApiCard } from "./SearchApiCard";

const searchConfig: SearchApiConfig = {
  id: "search-1",
  name: "Google Search",
  provider: "google",
  baseUrl: "https://www.googleapis.com/customsearch/v1",
  cx: "search-engine-id",
  maxResults: 5,
  enabled: true,
};

const fetchConfig: FetchApiConfig = {
  id: "fetch-1",
  name: "Firecrawl Reader",
  provider: "firecrawl",
  baseUrl: "https://api.firecrawl.dev/v1",
  enabled: true,
};

describe("web provider credential cards", () => {
  it("shows a configured search provider without rendering its stored secret", () => {
    render(
      <SearchApiCard
        config={searchConfig}
        hasStoredApiKey
        connectionStatus="connected"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const apiKeyInput = screen.getByLabelText("API Key");
    expect(screen.getByLabelText("Status: connected")).toHaveTextContent("Connected");
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(apiKeyInput).toHaveAttribute("type", "password");
    expect(apiKeyInput).toHaveValue("");
    expect(apiKeyInput).toHaveAttribute("placeholder", "Enter a new key to replace");
    expect(screen.queryByRole("button", { name: /show api key/i })).not.toBeInTheDocument();
  });

  it("clears a newly entered search credential from the field after editing", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(
      <SearchApiCard
        config={searchConfig}
        hasStoredApiKey={false}
        connectionStatus="disconnected"
        onUpdate={onUpdate}
        onDelete={vi.fn()}
      />,
    );

    const apiKeyInput = screen.getByLabelText("API Key");
    await user.type(apiKeyInput, "secret-value");
    expect(apiKeyInput).toHaveValue("secret-value");
    expect(onUpdate).toHaveBeenLastCalledWith("search-1", { apiKey: "secret-value" });

    await user.tab();
    expect(apiKeyInput).toHaveValue("");
  });

  it("applies the same protected credential treatment to fetch providers", () => {
    render(
      <FetchApiCard
        config={fetchConfig}
        hasStoredApiKey
        connectionStatus="connected"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const apiKeyInput = screen.getByLabelText("API Key");
    expect(screen.getByLabelText("Status: connected")).toHaveTextContent("Connected");
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(apiKeyInput).toHaveAttribute("type", "password");
    expect(apiKeyInput).toHaveValue("");
    expect(screen.queryByRole("button", { name: /show api key/i })).not.toBeInTheDocument();
  });

  it("shows a failed network connection", () => {
    render(
      <SearchApiCard
        config={searchConfig}
        hasStoredApiKey={false}
        connectionStatus="error"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Status: error")).toHaveTextContent("Connection error");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <SearchApiCard
        config={searchConfig}
        hasStoredApiKey
        connectionStatus="connecting"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect((await axe.run(container)).violations).toEqual([]);
  });
});
