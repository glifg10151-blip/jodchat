import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  saveSearchConfigs: vi.fn(),
  saveFetchConfigs: vi.fn(),
  saveSearchApiKeys: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../utils/storage", () => ({
  saveSearchConfigs: mocks.saveSearchConfigs,
  saveFetchConfigs: mocks.saveFetchConfigs,
  saveSearchApiKeys: mocks.saveSearchApiKeys,
}));

import type { FetchApiConfig, SearchApiConfig } from "../types";
import { useUIStore } from "./useUIStore";
import { useSearchStore } from "./useSearchStore";

const search: SearchApiConfig = {
  id: "search-1",
  name: "Search",
  provider: "google",
  baseUrl: "https://example.com",
  maxResults: 5,
  enabled: true,
};

const fetchConfig: FetchApiConfig = {
  id: "fetch-1",
  name: "Fetch",
  provider: "jina",
  baseUrl: "https://r.jina.ai",
  enabled: true,
};

describe("useSearchStore enabled config selection", () => {
  beforeEach(() => {
    useSearchStore.getState().stopConnectionChecks();
    vi.clearAllMocks();
    mocks.invoke.mockResolvedValue("[]");
    useSearchStore.setState({
      searchConfigs: [search],
      activeSearchId: search.id,
      searchApiKeys: {},
      searchStatuses: { [search.id]: "disconnected" },
      fetchConfigs: [fetchConfig],
      activeFetchId: fetchConfig.id,
      fetchStatuses: { [fetchConfig.id]: "disconnected" },
    });
    useUIStore.setState({ disableBgActivity: false, offlineMode: false });
  });

  afterEach(() => {
    useSearchStore.getState().stopConnectionChecks();
    vi.useRealTimers();
  });

  it("clears disabled search and fetch selections", () => {
    useSearchStore.getState().updateSearchConfig(search.id, { enabled: false });
    useSearchStore.getState().updateFetchConfig(fetchConfig.id, { enabled: false });

    expect(useSearchStore.getState().activeSearchId).toBeNull();
    expect(useSearchStore.getState().activeFetchId).toBeNull();
  });

  it("rejects selecting or executing a disabled search config", async () => {
    useSearchStore.getState().updateSearchConfig(search.id, { enabled: false });
    useSearchStore.getState().setActiveSearchId(search.id);

    await expect(useSearchStore.getState().performSearch("query", search, "key")).rejects.toThrow(
      "disabled or unavailable",
    );
    expect(useSearchStore.getState().activeSearchId).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("finishes a captured search independently of composer state", async () => {
    await expect(useSearchStore.getState().performSearch("query", search, "key")).resolves.toEqual([]);

    expect(mocks.invoke).toHaveBeenCalledWith("web_search", expect.objectContaining({ configId: search.id }));
    expect(useSearchStore.getState().searchStatuses[search.id]).toBe("disconnected");
  });

  it("rejects provider failures so the tool loop can mark them as errors", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Search backend unavailable"));

    await expect(useSearchStore.getState().performSearch("query", search, "key")).rejects.toThrow();
    expect(useSearchStore.getState().searchStatuses[search.id]).toBe("disconnected");
  });

  it("resets a stale connection result when provider settings change", () => {
    useSearchStore.setState({ searchStatuses: { [search.id]: "connected" } });

    useSearchStore.getState().updateSearchConfig(search.id, { baseUrl: "https://new.example.com" });

    expect(useSearchStore.getState().searchStatuses[search.id]).toBe("disconnected");
  });

  it("creates fetch providers with a usable default endpoint", () => {
    useSearchStore.setState({ fetchConfigs: [], activeFetchId: null });

    useSearchStore.getState().addFetchConfig();

    expect(useSearchStore.getState().fetchConfigs[0]?.baseUrl).toBe("https://api.firecrawl.dev/v1");
  });

  it("marks a search provider connected after a credential-free reachability request succeeds", async () => {
    await useSearchStore.getState().checkSearchConnections();

    expect(mocks.saveSearchApiKeys).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledWith("check_web_endpoint", {
      endpointUrl: search.baseUrl,
    });
    expect(useSearchStore.getState().searchStatuses[search.id]).toBe("connected");
  });

  it("marks a search provider as errored when its test request fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Network unavailable"));

    await useSearchStore.getState().checkSearchConnections();

    expect(useSearchStore.getState().searchStatuses[search.id]).toBe("error");
  });

  it("tests fetch provider reachability without a token or target page", async () => {
    mocks.invoke.mockResolvedValueOnce(true);

    await useSearchStore.getState().checkFetchConnections();

    expect(mocks.invoke).toHaveBeenCalledWith("check_web_endpoint", {
      endpointUrl: fetchConfig.baseUrl,
    });
    expect(useSearchStore.getState().fetchStatuses[fetchConfig.id]).toBe("connected");
  });

  it("automatically checks search and fetch reachability every 30 seconds and stops cleanly", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(true);

    useSearchStore.getState().startConnectionChecks();
    useSearchStore.getState().startConnectionChecks();

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mocks.invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke).toHaveBeenCalledWith("check_web_endpoint", { endpointUrl: search.baseUrl });
    expect(mocks.invoke).toHaveBeenCalledWith("check_web_endpoint", { endpointUrl: fetchConfig.baseUrl });

    mocks.invoke.mockClear();
    useSearchStore.getState().stopConnectionChecks();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("does not start automatic connection checks while background activity is disabled", async () => {
    vi.useFakeTimers();
    useUIStore.setState({ disableBgActivity: true });

    useSearchStore.getState().startConnectionChecks();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
