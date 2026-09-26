import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/externalUrl", () => ({
  openExternalUrl: vi.fn().mockResolvedValue(true),
}));

import { PluginsSection } from "./PluginsSection";
import { useMcpStore } from "../../../store/useMcpStore";
import { useUIStore } from "../../../store/useUIStore";
import { openExternalUrl } from "../../../utils/externalUrl";
import { invoke } from "@tauri-apps/api/core";

describe("PluginsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpStore.setState({
      mcpConfigs: [],
      serverStatuses: {},
      envSecrets: {},
      enabledServerIds: new Set(),
    });
    useUIStore.setState({
      toasts: [],
    });
  });

  it("renders section header, search bar, and category buttons", () => {
    render(<PluginsSection />);

    expect(screen.getByText(/Plugins & Apps/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Search 50\+ plugins/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Featured/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Developer/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Productivity/i })).toBeInTheDocument();
  });

  it("renders catalog cards with brand titles", () => {
    render(<PluginsSection />);

    expect(screen.getByTestId("plugin-card-github")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-notion")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-slack")).toBeInTheDocument();
    expect(screen.getByTestId("plugin-card-linear")).toBeInTheDocument();
  });

  it("filters plugins when typing in the search bar", () => {
    render(<PluginsSection />);

    const searchInput = screen.getByPlaceholderText(/Search 50\+ plugins/i);
    fireEvent.change(searchInput, { target: { value: "Linear" } });

    expect(screen.getByTestId("plugin-card-linear")).toBeInTheDocument();
    expect(screen.queryByTestId("plugin-card-spotify")).not.toBeInTheDocument();
  });

  it("opens modal when clicking on a card", () => {
    render(<PluginsSection />);

    const githubCard = screen.getByTestId("plugin-card-github");
    fireEvent.click(githubCard);

    expect(screen.getByText(/1-Click Connect with GitHub/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal Access Token manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal Access Token manually/i));

    expect(screen.getByText("GitHub Personal Access Token")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("ghp_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize GitHub/i })).toBeInTheDocument();
  });

  it("opens modal for Linear and displays 1-Click OAuth", () => {
    render(<PluginsSection />);

    const linearCard = screen.getByTestId("plugin-card-linear");
    fireEvent.click(linearCard);

    expect(screen.getByText(/1-Click Connect with Linear/i)).toBeInTheDocument();
    expect(screen.getByText(/Or enter a Personal API Key manually/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or enter a Personal API Key manually/i));

    expect(screen.getByText("Linear Personal API Key")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("lin_api_...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize Linear/i })).toBeInTheDocument();
  });

  it("keeps Google credentials editable and shows one inline validation error", async () => {
    render(<PluginsSection />);

    const gdriveCard = screen.getByTestId("plugin-card-google-drive");
    fireEvent.click(gdriveCard);

    expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Google Client Secret/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Import JSON/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/Google Cloud setup/i)[0]).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toBeInTheDocument();

    // Click Get Credentials
    const getCredsBtn = screen.getByRole("button", { name: /Google Cloud setup/i });
    fireEvent.click(getCredsBtn);
    expect(openExternalUrl).toHaveBeenCalledWith("https://console.cloud.google.com/apis/credentials");

    // Click Connect without entering secret -> triggers pre-flight error
    const connectBtn = screen.getByRole("button", { name: /Continue with Google/i });
    await waitFor(() => expect(connectBtn).not.toBeDisabled());
    fireEvent.click(connectBtn);
    expect(await screen.findByText(/Import a Google Desktop app credentials file/i)).toBeInTheDocument();

    expect(screen.getByLabelText("Google Client ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Try Again|Edit Credentials|Service Account/i }),
    ).not.toBeInTheDocument();
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it("reuses the saved Google client without loading masked plugin secrets", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ clientId: "shared.apps.googleusercontent.com" });
    render(<PluginsSection />);
    fireEvent.click(screen.getByTestId("plugin-card-google-drive"));
    await waitFor(() =>
      expect(screen.getByLabelText("Google Client ID")).toHaveValue("shared.apps.googleusercontent.com"),
    );
    expect(screen.getByPlaceholderText(/GOCSPX-.../i)).toHaveValue("");
    expect(screen.getByText(/Google OAuth client is encrypted and shared/i)).toBeInTheDocument();
  });

  it("opens modal for Spotify and displays 1-Click OAuth with manual fallback", () => {
    render(<PluginsSection />);

    const spotifyCard = screen.getByTestId("plugin-card-spotify");
    fireEvent.click(spotifyCard);

    expect(screen.getByText(/1-Click Connect with Spotify/i)).toBeInTheDocument();
    expect(screen.getByText(/Or specify a custom Spotify Client ID/i)).toBeInTheDocument();

    // Click manual token toggle
    fireEvent.click(screen.getByText(/Or specify a custom Spotify Client ID/i));

    expect(screen.getByText(/Spotify Client ID/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Leave blank to use Sythoria Default/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Authorize Spotify/i })).toBeInTheDocument();
  });

  it("renders installed plugins ribbon and revokes access when cross button is clicked", async () => {
    useMcpStore.setState({
      mcpConfigs: [
        {
          id: "linear-mcp-1",
          name: "Linear",
          transport: "stdio",
          command: "npx",
          args: ["-y", "linear-mcp-server"],
          enabled: true,
          trustLevel: "untrusted",
        },
      ],
      serverStatuses: {
        "linear-mcp-1": "connected",
      },
      enabledServerIds: new Set(["linear-mcp-1"]),
    });

    render(<PluginsSection />);

    expect(screen.getByText(/Installed Plugins \(1\)/i)).toBeInTheDocument();
    expect(screen.getByTitle("Configure Linear")).toBeInTheDocument();

    const revokeButton = screen.getByRole("button", { name: /Revoke access for Linear/i });
    expect(revokeButton).toBeInTheDocument();

    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({
          message: "Revoked access for Linear",
          variant: "info",
        }),
      );
    });
  });
});
