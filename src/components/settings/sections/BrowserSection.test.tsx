import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FetchApiConfig, SearchApiConfig } from "../../../types";
import { BrowserSection } from "./BrowserSection";

const searchConfig: SearchApiConfig = {
  id: "search-1",
  name: "SearXNG",
  provider: "searxng",
  baseUrl: "http://localhost:8080",
  maxResults: 5,
  enabled: true,
};

const fetchConfig: FetchApiConfig = {
  id: "fetch-1",
  name: "Jina Reader",
  provider: "jina",
  baseUrl: "https://r.jina.ai",
  enabled: true,
};

describe("BrowserSection connection checks", () => {
  it("lets the user test search and fetch providers", async () => {
    const user = userEvent.setup();
    const checkSearchConnections = vi.fn().mockResolvedValue(undefined);
    const checkFetchConnections = vi.fn().mockResolvedValue(undefined);

    render(
      <BrowserSection
        searchConfigs={[searchConfig]}
        updateSearchConfig={vi.fn()}
        deleteSearchConfig={vi.fn()}
        addSearchConfig={vi.fn()}
        searchApiKeys={{}}
        searchStatuses={{ [searchConfig.id]: "disconnected" }}
        checkSearchConnections={checkSearchConnections}
        fetchConfigs={[fetchConfig]}
        updateFetchConfig={vi.fn()}
        deleteFetchConfig={vi.fn()}
        addFetchConfig={vi.fn()}
        fetchStatuses={{ [fetchConfig.id]: "disconnected" }}
        checkFetchConnections={checkFetchConnections}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Test search connections" }));
    await user.click(screen.getByRole("button", { name: "Test fetch connections" }));

    expect(checkSearchConnections).toHaveBeenCalledOnce();
    expect(checkFetchConnections).toHaveBeenCalledOnce();
  });
});
