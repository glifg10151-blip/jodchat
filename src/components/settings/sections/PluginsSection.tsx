import { Select } from "../../ui/Select";
import { googlePermissions, type GoogleAccess } from "../../../services/googlePermissions";
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Search,
  Check,
  Plus,
  ExternalLink,
  RefreshCw,
  X,
  Shield,
  Trash2,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
  ArrowRight,
  Sliders,
  Copy,
  Upload,
} from "lucide-react";
import { useTranslation } from "../../../utils/i18n";
import { useMcpStore } from "../../../store/useMcpStore";
import { useUIStore } from "../../../store/useUIStore";
import { PLUGINS_CATALOG, PLUGIN_CATEGORIES, PluginItem, PluginCategory } from "../../../config/pluginsCatalog";
import { motionTransitions } from "../../../lib/motion-tokens";
import { SettingsPanel, SettingsSectionHeader } from "../components/SettingsPrimitives";
import { BrandIcon } from "../../ui/BrandIcons";
import { startGitHubDeviceFlow, pollGitHubDeviceToken } from "../../../services/githubOAuth";
import { startLinearOAuthFlow, DEFAULT_LINEAR_CLIENT_ID } from "../../../services/linearOAuth";
import {
  startGoogleOAuthFlow,
  saveGoogleMcpTokens,
  buildGoogleMcpEnvironment,
  parseGoogleClientSecretsFile,
  getGoogleOAuthClient,
  saveGoogleOAuthClient,
} from "../../../services/googleOAuth";
import {
  startSpotifyOAuthFlow,
  saveSpotifyMcpTokens,
  DEFAULT_SPOTIFY_CLIENT_ID,
  DEFAULT_SPOTIFY_SCOPES,
} from "../../../services/spotifyOAuth";
import { openExternalUrl } from "../../../utils/externalUrl";

function formatOAuthError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    for (const key of ["RequestFailed", "AuthError", "ApiError", "ParseError", "McpError", "message", "error"]) {
      if (typeof rec[key] === "string" && rec[key]) return rec[key] as string;
    }
    try {
      return JSON.stringify(err);
    } catch {
      // ignore
    }
  }
  return fallback;
}

// Sythoria Desktop Official Brand Logo Mark
const SythoriaMark: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 128 128"
    fill="none"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="sythoria-official-bg" x1="24" y1="12" x2="104" y2="116" gradientUnits="userSpaceOnUse">
        <stop stopColor="#1D1938" />
        <stop offset="1" stopColor="#0F1023" />
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="32" fill="url(#sythoria-official-bg)" />
    <path
      d="M36 39L64 22L92 39C98 42.5 101 47.5 101 54V83C101 89.5 98 94.5 92 98L64 115L36 98C30 94.5 27 89.5 27 83V54C27 47.5 30 42.5 36 39Z"
      stroke="#30218F"
      strokeWidth="3"
    />
    <path
      d="M31 35L59 18L87 35C93 38.5 96 43.5 96 50V79C96 85.5 93 90.5 87 94L59 111L31 94C25 90.5 22 85.5 22 79V50C22 43.5 25 38.5 31 35Z"
      stroke="#4935C4"
      strokeWidth="3"
    />
    <path
      d="M27 32L55 15L83 32C89 35.5 92 40.5 92 47V76C92 82.5 89 87.5 83 91L55 108L27 91C21 87.5 18 82.5 18 76V47C18 40.5 21 35.5 27 32Z"
      fill="#26213F"
      stroke="#765DFF"
      strokeWidth="4"
    />
    <path d="M55 31L69 58.5L55 86L41 58.5L55 31Z" fill="#8D7DE0" />
  </svg>
);

export function PluginsSection() {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);

  // MCP Store state
  const mcpConfigs = useMcpStore((s) => s.mcpConfigs);
  const serverStatuses = useMcpStore((s) => s.serverStatuses);
  const envSecrets = useMcpStore((s) => s.envSecrets);
  const enabledServerIds = useMcpStore((s) => s.enabledServerIds);
  const deleteMcpConfig = useMcpStore((s) => s.deleteMcpConfig);
  const toggleServerEnabled = useMcpStore((s) => s.toggleServerEnabled);

  // Local UI State
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeModalPlugin, setActiveModalPlugin] = useState<PluginItem | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showPasswordMap, setShowPasswordMap] = useState<Record<string, boolean>>({});
  const [showReauthForm, setShowReauthForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Map installed MCP configs to catalog items
  const installedPluginMap = useMemo(() => {
    const map = new Map<string, { configId: string; isConnected: boolean; isEnabled: boolean }>();
    for (const config of mcpConfigs) {
      const matched = config.catalogPluginId
        ? PLUGINS_CATALOG.find((plugin) => plugin.id === config.catalogPluginId)
        : PLUGINS_CATALOG.find(
            (plugin) =>
              plugin.id === config.id ||
              plugin.name.toLowerCase() === config.name.toLowerCase() ||
              plugin.preset.name.toLowerCase() === config.name.toLowerCase(),
          );
      if (matched) {
        const isConnected = serverStatuses[config.id] === "connected";
        const isEnabled = enabledServerIds.has(config.id);
        map.set(matched.id, { configId: config.id, isConnected, isEnabled });
      }
    }
    return map;
  }, [mcpConfigs, serverStatuses, enabledServerIds]);

  // List of currently installed catalog plugins for top status
  const installedPlugins = useMemo(() => {
    return PLUGINS_CATALOG.filter((plugin) => installedPluginMap.has(plugin.id));
  }, [installedPluginMap]);

  // Filter catalog by search query
  const filteredCatalog = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return PLUGINS_CATALOG;

    return PLUGINS_CATALOG.filter((plugin) => {
      return (
        plugin.name.toLowerCase().includes(q) ||
        plugin.description.toLowerCase().includes(q) ||
        plugin.keywords.some((k) => k.toLowerCase().includes(q))
      );
    });
  }, [searchQuery]);

  // Group plugins by category for structured scrolling
  const categoryGroups = useMemo(() => {
    return PLUGIN_CATEGORIES.map((cat) => {
      const items = filteredCatalog.filter((plugin) => plugin.category === cat.id);
      return {
        ...cat,
        items,
      };
    }).filter((group) => {
      if (selectedCategory === "all") return group.items.length > 0;
      return group.id === selectedCategory && group.items.length > 0;
    });
  }, [filteredCatalog, selectedCategory]);

  // GitHub 1-Click Device Flow OAuth State
  const [githubOAuth, setGithubOAuth] = useState<{
    isActive: boolean;
    userCode: string;
    verificationUri: string;
    isPolling: boolean;
    error: string | null;
  }>({
    isActive: false,
    userCode: "",
    verificationUri: "",
    isPolling: false,
    error: null,
  });
  const githubAbortRef = useRef<AbortController | null>(null);

  // Linear 1-Click PKCE OAuth State
  const [linearOAuth, setLinearOAuth] = useState<{
    isActive: boolean;
    isConnecting: boolean;
    error: string | null;
  }>({
    isActive: false,
    isConnecting: false,
    error: null,
  });
  const linearAbortRef = useRef<AbortController | null>(null);

  // Google 1-Click PKCE OAuth State
  const [googleOAuth, setGoogleOAuth] = useState<{
    isActive: boolean;
    isConnecting: boolean;
    error: string | null;
  }>({
    isActive: false,
    isConnecting: false,
    error: null,
  });
  const googleAbortRef = useRef<AbortController | null>(null);
  const [googleAccess, setGoogleAccess] = useState<GoogleAccess>("read");

  const [savedGoogleClientId, setSavedGoogleClientId] = useState<string | null>(null);
  const [googleClientLoading, setGoogleClientLoading] = useState(false);
  useEffect(() => {
    if (!activeModalPlugin || !["gmail", "google-drive", "google-calendar"].includes(activeModalPlugin.id)) return;
    let active = true;
    void getGoogleOAuthClient()
      .then((client) => {
        if (!active) return;
        setSavedGoogleClientId(client?.clientId ?? null);
        setFormValues((prev) => ({ ...prev, GOOGLE_CLIENT_ID: client?.clientId ?? "", GOOGLE_CLIENT_SECRET: "" }));
      })
      .catch(() => {
        if (active)
          setGoogleOAuth({
            isActive: false,
            isConnecting: false,
            error: "Could not load saved Google credentials. Try opening setup again.",
          });
      })
      .finally(() => {
        if (active) setGoogleClientLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeModalPlugin]);

  // Spotify 1-Click PKCE OAuth State
  const [spotifyOAuth, setSpotifyOAuth] = useState<{
    isActive: boolean;
    isConnecting: boolean;
    error: string | null;
  }>({
    isActive: false,
    isConnecting: false,
    error: null,
  });
  const spotifyAbortRef = useRef<AbortController | null>(null);

  const [showManualToken, setShowManualToken] = useState(false);

  // Clean up pending OAuth polling on unmount
  useEffect(() => {
    return () => {
      if (githubAbortRef.current) {
        githubAbortRef.current.abort();
        githubAbortRef.current = null;
      }
      if (linearAbortRef.current) {
        linearAbortRef.current.abort();
        linearAbortRef.current = null;
      }
      if (googleAbortRef.current) {
        googleAbortRef.current.abort();
        googleAbortRef.current = null;
      }
      if (spotifyAbortRef.current) {
        spotifyAbortRef.current.abort();
        spotifyAbortRef.current = null;
      }
    };
  }, []);

  // Open modal and pre-fill existing env secrets if already installed
  const handleOpenModal = useCallback(
    (plugin: PluginItem) => {
      setActiveModalPlugin(plugin);
      setGoogleAccess("read");
      setGoogleClientLoading(["gmail", "google-drive", "google-calendar"].includes(plugin.id));
      setSavedGoogleClientId(null);
      setShowManualToken(false);
      setGithubOAuth({
        isActive: false,
        userCode: "",
        verificationUri: "",
        isPolling: false,
        error: null,
      });
      setLinearOAuth({
        isActive: false,
        isConnecting: false,
        error: null,
      });
      setGoogleOAuth({
        isActive: false,
        isConnecting: false,
        error: null,
      });
      setSpotifyOAuth({
        isActive: false,
        isConnecting: false,
        error: null,
      });
      const installedInfo = installedPluginMap.get(plugin.id);
      const initialForm: Record<string, string> = {};

      if (installedInfo) {
        const existingSecrets = envSecrets[installedInfo.configId] || {};
        for (const field of plugin.authFields) {
          initialForm[field.key] = existingSecrets[field.key] || "";
        }
      } else {
        for (const field of plugin.authFields) {
          initialForm[field.key] = "";
        }
      }

      setFormValues(initialForm);
      setShowPasswordMap({});
      setShowReauthForm(false);
    },
    [installedPluginMap, envSecrets],
  );

  const handleCloseModal = () => {
    if (githubAbortRef.current) {
      githubAbortRef.current.abort();
      githubAbortRef.current = null;
    }
    if (linearAbortRef.current) {
      linearAbortRef.current.abort();
      linearAbortRef.current = null;
    }
    if (googleAbortRef.current) {
      googleAbortRef.current.abort();
      googleAbortRef.current = null;
    }
    if (spotifyAbortRef.current) {
      spotifyAbortRef.current.abort();
      spotifyAbortRef.current = null;
    }
    setGithubOAuth({
      isActive: false,
      userCode: "",
      verificationUri: "",
      isPolling: false,
      error: null,
    });
    setLinearOAuth({
      isActive: false,
      isConnecting: false,
      error: null,
    });
    setGoogleOAuth({
      isActive: false,
      isConnecting: false,
      error: null,
    });
    setSpotifyOAuth({
      isActive: false,
      isConnecting: false,
      error: null,
    });
    setShowManualToken(false);
    setShowReauthForm(false);
    setActiveModalPlugin(null);
    setFormValues({});
    setIsSubmitting(false);
  };

  // 1-Click GitHub Device Flow OAuth
  const handleStartGitHubOAuth = async () => {
    if (githubAbortRef.current) {
      githubAbortRef.current.abort();
    }
    const abortController = new AbortController();
    githubAbortRef.current = abortController;

    setGithubOAuth({
      isActive: true,
      userCode: "",
      verificationUri: "",
      isPolling: true,
      error: null,
    });

    try {
      const codeResult = await startGitHubDeviceFlow();
      setGithubOAuth({
        isActive: true,
        userCode: codeResult.user_code,
        verificationUri: codeResult.verification_uri,
        isPolling: true,
        error: null,
      });

      // Copy user code to clipboard
      try {
        await navigator.clipboard.writeText(codeResult.user_code);
        addToast(`Code copied: ${codeResult.user_code}`, "info");
      } catch {
        // clipboard might be restricted
      }

      // Open browser to GitHub authorization page
      await openExternalUrl(codeResult.verification_uri);

      // Start polling for token
      const token = await pollGitHubDeviceToken(
        codeResult.device_code,
        undefined,
        codeResult.interval,
        abortController.signal,
      );

      // Successfully authorized
      const plugin = PLUGINS_CATALOG.find((p) => p.id === "github");
      if (plugin) {
        const success = await useMcpStore
          .getState()
          .addMcpConfigWithSecrets(
            plugin.preset,
            { GITHUB_PERSONAL_ACCESS_TOKEN: token },
            { catalogPluginId: plugin.id },
          );

        if (success) {
          addToast(`Connected ${plugin.name}`, "success");
          handleCloseModal();
        }
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      const errorMsg = formatOAuthError(err, "GitHub OAuth failed");
      setGithubOAuth((prev) => ({
        ...prev,
        isPolling: false,
        error: errorMsg,
      }));
      addToast(errorMsg, "error");
    }
  };

  // 1-Click Linear PKCE OAuth
  const handleStartLinearOAuth = async () => {
    if (linearAbortRef.current) {
      linearAbortRef.current.abort();
    }
    const abortController = new AbortController();
    linearAbortRef.current = abortController;

    setLinearOAuth({
      isActive: true,
      isConnecting: true,
      error: null,
    });

    try {
      const token = await startLinearOAuthFlow(
        DEFAULT_LINEAR_CLIENT_ID,
        undefined,
        undefined,
        undefined,
        abortController.signal,
      );

      // Successfully authorized
      const plugin = PLUGINS_CATALOG.find((p) => p.id === "linear");
      if (plugin) {
        const success = await useMcpStore
          .getState()
          .addMcpConfigWithSecrets(
            plugin.preset,
            { LINEAR_API_KEY: token, LINEAR_ACCESS_TOKEN: token },
            { catalogPluginId: plugin.id },
          );

        if (success) {
          addToast(`Connected ${plugin.name}`, "success");
          handleCloseModal();
        }
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      const errorMsg = formatOAuthError(err, "Linear OAuth failed");
      setLinearOAuth({
        isActive: true,
        isConnecting: false,
        error: errorMsg,
      });
      addToast(errorMsg, "error");
    }
  };

  // Import credentials file downloaded from Google Cloud Console (client_secret_xxx.json)
  const handleImportGoogleCredentials = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const parsed = parseGoogleClientSecretsFile(String(event.target?.result ?? ""));
      if (parsed.clientId && parsed.clientSecret) {
        setFormValues((prev) => ({
          ...prev,
          GOOGLE_CLIENT_ID: parsed.clientId!,
          GOOGLE_CLIENT_SECRET: parsed.clientSecret!,
        }));
        setGoogleOAuth({ isActive: false, isConnecting: false, error: null });
      } else {
        setGoogleOAuth({
          isActive: false,
          isConnecting: false,
          error: "Import the JSON for a Google Desktop app OAuth client, including its client ID and secret.",
        });
      }
    };
    reader.onerror = () =>
      setGoogleOAuth({
        isActive: false,
        isConnecting: false,
        error: "Could not read the credentials file. Try importing it again.",
      });
    reader.readAsText(file);
    e.target.value = "";
  };

  // Google Desktop OAuth
  const handleStartGoogleOAuth = async (plugin: PluginItem) => {
    if (googleAbortRef.current) {
      googleAbortRef.current.abort();
    }
    const abortController = new AbortController();
    googleAbortRef.current = abortController;

    setGoogleOAuth({
      isActive: true,
      isConnecting: true,
      error: null,
    });

    try {
      const customClientId = formValues["GOOGLE_CLIENT_ID"]?.trim() || undefined;
      const customClientSecret = formValues["GOOGLE_CLIENT_SECRET"]?.trim() || undefined;
      const effectiveClientId = customClientId || savedGoogleClientId;

      if (!effectiveClientId || (!customClientSecret && effectiveClientId !== savedGoogleClientId)) {
        throw new Error("Import a Google Desktop app credentials file, or enter its matching client ID and secret.");
      }
      if (customClientSecret) {
        await saveGoogleOAuthClient(effectiveClientId, customClientSecret);
        if (abortController.signal.aborted) return;
        setSavedGoogleClientId(effectiveClientId);
        setFormValues((prev) => ({ ...prev, GOOGLE_CLIENT_SECRET: "" }));
      }

      const permissions = googlePermissions(plugin.id, googleAccess);
      const tokens = await startGoogleOAuthFlow(
        effectiveClientId,
        permissions.scopes.join(" "),
        abortController.signal,
      );

      if (abortController.signal.aborted) return;

      // Keep the reusable grant in native encrypted storage; plugins receive it only at runtime.
      const grantReference = await saveGoogleMcpTokens(
        effectiveClientId,
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn,
        tokens.scope,
      );

      if (abortController.signal.aborted) return;

      const secrets: Record<string, string> = {
        ...buildGoogleMcpEnvironment(plugin.id, grantReference),
        SYTHORIA_ALLOWED_TOOLS: JSON.stringify(permissions.tools),
        ...(plugin.id === "gmail"
          ? {}
          : {
              GOOGLE_DRIVE_MCP_SCOPES: permissions.scopes.join(","),
              GOOGLE_DRIVE_MCP_DISABLE_RESOURCES: "true",
            }),
      };

      const success = await useMcpStore
        .getState()
        .addMcpConfigWithSecrets(plugin.preset, secrets, { notify: false, catalogPluginId: plugin.id });

      if (success) {
        addToast(`Connected ${plugin.name}`, "success");
        if (!abortController.signal.aborted) handleCloseModal();
      } else if (!abortController.signal.aborted) {
        setGoogleOAuth({
          isActive: true,
          isConnecting: false,
          error:
            "Google authorization completed, but the plugin could not start. Check its connection settings and try again.",
        });
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      const errorMsg = formatOAuthError(err, "Google OAuth failed");
      setGoogleOAuth({
        isActive: true,
        isConnecting: false,
        error: errorMsg,
      });
    }
  };

  // 1-Click Spotify PKCE OAuth
  const handleStartSpotifyOAuth = async (plugin: PluginItem) => {
    if (spotifyAbortRef.current) {
      spotifyAbortRef.current.abort();
    }
    const abortController = new AbortController();
    spotifyAbortRef.current = abortController;

    setSpotifyOAuth({
      isActive: true,
      isConnecting: true,
      error: null,
    });

    try {
      const customClientId = formValues["SPOTIFY_CLIENT_ID"]?.trim() || undefined;
      const tokens = await startSpotifyOAuthFlow(
        customClientId || DEFAULT_SPOTIFY_CLIENT_ID,
        DEFAULT_SPOTIFY_SCOPES,
        undefined,
        undefined,
        abortController.signal,
      );

      // Save tokens atomically to ~/.spotify-mcp/tokens.json for spotify-mcp server
      await saveSpotifyMcpTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);

      // Build secrets map
      const secrets: Record<string, string> = {
        SPOTIFY_CLIENT_ID: customClientId || DEFAULT_SPOTIFY_CLIENT_ID,
        SPOTIFY_ACCESS_TOKEN: tokens.accessToken,
      };

      const success = await useMcpStore
        .getState()
        .addMcpConfigWithSecrets(plugin.preset, secrets, { catalogPluginId: plugin.id });

      if (success) {
        addToast(`Connected ${plugin.name}`, "success");
        handleCloseModal();
      }
    } catch (err: unknown) {
      if (abortController.signal.aborted) return;
      const errorMsg = formatOAuthError(err, "Spotify OAuth failed");
      setSpotifyOAuth({
        isActive: true,
        isConnecting: false,
        error: errorMsg,
      });
      addToast(errorMsg, "error");
    }
  };

  // Connect or Update plugin
  const handleConnectPlugin = async () => {
    if (!activeModalPlugin) return;
    setIsSubmitting(true);

    try {
      const plugin = activeModalPlugin;
      const installedInfo = installedPluginMap.get(plugin.id);

      const secretsToSave: Record<string, string> = {};
      for (const field of plugin.authFields) {
        const val = formValues[field.key];
        if (val !== undefined) {
          secretsToSave[field.key] = val.trim();
        }
      }

      const success = await useMcpStore
        .getState()
        .addMcpConfigWithSecrets(plugin.preset, secretsToSave, { catalogPluginId: plugin.id });

      if (success) {
        addToast(installedInfo ? `Updated authorization for ${plugin.name}` : `Connected ${plugin.name}`, "success");
        handleCloseModal();
      }
    } catch {
      addToast(`Failed to authorize ${activeModalPlugin.name}`, "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Fast one-click install for Zero-Config plugins
  const handleQuickConnect = async (plugin: PluginItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (plugin.authFields.length > 0) {
      handleOpenModal(plugin);
      return;
    }

    try {
      const success = await useMcpStore
        .getState()
        .addMcpConfigWithSecrets(plugin.preset, {}, { catalogPluginId: plugin.id });
      if (success) {
        addToast(`Connected ${plugin.name}`, "success");
      }
    } catch {
      addToast(`Failed to authorize ${plugin.name}`, "error");
    }
  };

  // Disconnect / remove plugin
  const handleDisconnectPlugin = async (plugin: PluginItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const installedInfo = installedPluginMap.get(plugin.id);
    if (!installedInfo) return;

    try {
      await toggleServerEnabled(installedInfo.configId, false);
      await deleteMcpConfig(installedInfo.configId);
      addToast(
        ["gmail", "google-drive", "google-calendar"].includes(plugin.id)
          ? `Disconnected ${plugin.name}`
          : `Revoked access for ${plugin.name}`,
        "info",
      );
      if (activeModalPlugin?.id === plugin.id) {
        handleCloseModal();
      }
    } catch {
      addToast(`Failed to revoke ${plugin.name}`, "error");
    }
  };

  const isGoogleConnection =
    !!activeModalPlugin && ["gmail", "google-drive", "google-calendar"].includes(activeModalPlugin.id);

  return (
    <div className="space-y-6 pb-16 max-w-4xl mx-auto">
      {/* Header */}
      <SettingsSectionHeader
        title={t("settings.plugins.title") || "Plugins & Apps"}
        description={
          t("settings.plugins.subtitle") || "Connect Sythoria with your favorite tools, services, and local data."
        }
      />

      {/* Installed Ribbon (if any plugins are active) */}
      {installedPlugins.length > 0 && (
        <SettingsPanel>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("settings.plugins.installedCount", { count: String(installedPlugins.length) }) ||
                `Installed Plugins (${installedPlugins.length})`}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {installedPlugins.map((plugin) => {
              const info = installedPluginMap.get(plugin.id);
              const isConnected = info?.isConnected;

              return (
                <div
                  key={plugin.id}
                  className="flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-xl border border-border/80 bg-hover/40 hover:bg-hover hover:border-accent/40 text-xs font-medium text-text-primary transition-all group"
                >
                  <button
                    type="button"
                    onClick={() => handleOpenModal(plugin)}
                    className="flex items-center gap-2 text-text-primary hover:text-accent transition-colors focus:outline-none"
                    title={`Configure ${plugin.name}`}
                  >
                    <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0">
                      <BrandIcon name={plugin.id} iconUrl={plugin.icon} size={18} />
                    </div>
                    <span>{plugin.name}</span>
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isConnected ? "bg-emerald-500 shadow-sm shadow-emerald-500/50" : "bg-text-muted/40"
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDisconnectPlugin(plugin, e)}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded-md text-text-muted hover:text-red-400 hover:bg-red-500/15 transition-all focus:outline-none"
                    title={`Revoke access for ${plugin.name}`}
                    aria-label={`Revoke access for ${plugin.name}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </SettingsPanel>
      )}

      {/* Search & Category Filter Pills */}
      <div className="space-y-3">
        {/* Search Bar */}
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              t("settings.plugins.searchPlaceholder") || "Search 50+ plugins (e.g., GitHub, Notion, Slack, Postgres)..."
            }
            className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-input-border bg-input text-sm text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary p-1 rounded-md"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setSelectedCategory("all")}
            title={`All (${PLUGINS_CATALOG.length})`}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedCategory === "all"
                ? "bg-accent text-accent-foreground shadow-sm"
                : "bg-surface border border-border text-text-muted hover:text-text-primary hover:bg-hover"
            }`}
          >
            {t("settings.plugins.categoryAll") || "All"}
          </button>
          {PLUGIN_CATEGORIES.map((cat) => {
            const count = PLUGINS_CATALOG.filter((p) => p.category === cat.id).length;
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                title={`${t(cat.labelKey) || cat.id} (${count})`}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-accent text-accent-foreground shadow-sm"
                    : "bg-surface border border-border text-text-muted hover:text-text-primary hover:bg-hover"
                }`}
              >
                {t(cat.labelKey) || cat.id}
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrolling Category Sections (Clean 2-Column List Layout) */}
      <div className="space-y-8 pt-2">
        {categoryGroups.map((group) => {
          return (
            <div key={group.id} className="space-y-3">
              {/* Category Section Header */}
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <h4 className="text-sm font-semibold text-text-primary tracking-tight">
                  {t(group.labelKey) || group.id}
                </h4>
                <span className="text-xs text-text-muted">{group.items.length} apps</span>
              </div>

              {/* 2-Column Clean Rows Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                {group.items.map((plugin) => {
                  const installedInfo = installedPluginMap.get(plugin.id);
                  const isInstalled = Boolean(installedInfo);
                  const isConnected = installedInfo?.isConnected;
                  const isGoogleApp =
                    plugin.id === "google-drive" || plugin.id === "gmail" || plugin.id === "google-calendar";

                  return (
                    <div
                      key={plugin.id}
                      role="button"
                      tabIndex={0}
                      data-testid={`plugin-card-${plugin.id}`}
                      onClick={() => handleOpenModal(plugin)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleOpenModal(plugin);
                        }
                      }}
                      className="px-3 py-2.5 rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-between gap-3 group hover:bg-hover active:bg-active"
                    >
                      {/* Left: Brand Icon + Title & Subtitle */}
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className="w-11 h-11 rounded-2xl bg-[#141415] border border-black/5 dark:border-white/5 flex items-center justify-center shrink-0 shadow-sm relative p-2">
                          <BrandIcon name={plugin.id} iconUrl={plugin.icon} size={24} showSparkle={isGoogleApp} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-semibold text-text-primary truncate">{plugin.name}</span>
                          </div>
                          <p className="text-xs text-text-muted truncate mt-0.5">{plugin.description}</p>
                        </div>
                      </div>

                      {/* Right: + Connect Button or Active Pill */}
                      <div className="shrink-0 pl-1">
                        {isInstalled ? (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-medium ${
                                isConnected
                                  ? "text-emerald-500 dark:text-emerald-400"
                                  : "text-amber-500 dark:text-amber-400"
                              }`}
                              title={isConnected ? "Active & Connected" : "Paused"}
                            >
                              {isConnected ? <Check size={18} strokeWidth={2.5} /> : <Sliders size={15} />}
                            </span>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => void handleQuickConnect(plugin, e)}
                            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-hover rounded-lg transition-colors"
                            title={`Connect ${plugin.name}`}
                          >
                            <Plus size={20} strokeWidth={2} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ChatGPT-Style Full OAuth Authorization Modal */}
      <AnimatePresence>
        {activeModalPlugin && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={motionTransitions.content}
              className="bg-surface border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
            >
              {/* Modal Top Header (Close Button) */}
              <div className="pt-4 pr-4 flex justify-end">
                <button
                  onClick={handleCloseModal}
                  className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              {installedPluginMap.has(activeModalPlugin.id) && !showReauthForm ? (
                /* ========================================================= */
                /* 1. ALREADY CONNECTED MANAGEMENT VIEW                      */
                /* ========================================================= */
                (() => {
                  const info = installedPluginMap.get(activeModalPlugin.id)!;
                  return (
                    <div className="px-6 pb-6 pt-2 space-y-6 overflow-y-auto flex-1 text-sm">
                      {/* Connection Visual Header */}
                      <div className="text-center space-y-3">
                        <div className="flex items-center justify-center gap-3 mb-3">
                          <div className="w-12 h-12 rounded-2xl bg-[#141415] border border-border dark:border-white/10 flex items-center justify-center shadow-md p-1.5">
                            <SythoriaMark size={36} />
                          </div>

                          <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                            <span className="w-2.5 h-0.5 bg-emerald-500/40 rounded" />
                            <div className="w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm shadow-emerald-500/20">
                              <Check size={14} strokeWidth={3} />
                            </div>
                            <span className="w-2.5 h-0.5 bg-emerald-500/40 rounded" />
                          </div>

                          <div className="w-12 h-12 rounded-2xl bg-[#141415] border border-border dark:border-white/10 flex items-center justify-center shadow-md p-2 relative">
                            <BrandIcon
                              name={activeModalPlugin.id}
                              iconUrl={activeModalPlugin.icon}
                              size={28}
                              showSparkle={
                                activeModalPlugin.id === "google-drive" ||
                                activeModalPlugin.id === "gmail" ||
                                activeModalPlugin.id === "google-calendar"
                              }
                            />
                            <div className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-surface dark:border-[#141415] rounded-full shadow-xs" />
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-center gap-2">
                            <h3 className="text-lg font-semibold text-text-primary">{activeModalPlugin.name}</h3>
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 dark:border-emerald-500/30 flex items-center gap-1.5 shadow-xs">
                              <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse" />
                              {info.isConnected ? "Connected" : "Not connected"}
                            </span>
                          </div>
                          <p className="text-xs text-text-muted mt-1 max-w-sm mx-auto">
                            {info.isConnected
                              ? `${activeModalPlugin.name} tools are available for chat.`
                              : "Reconnect this plugin to use its tools."}
                          </p>
                        </div>
                      </div>

                      {/* Active Connection Status & Privacy Info */}
                      <div className="p-4 rounded-xl border border-border/80 bg-hover/20 space-y-3">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-text-muted font-medium">Integration Status</span>
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-500" />
                            {info.isConnected
                              ? "Connected"
                              : serverStatuses[info.configId] === "error"
                                ? "Connection failed"
                                : "Disconnected"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2.5 border-t border-border/40">
                          <span className="text-text-muted font-medium">Data Privacy & Security</span>
                          <span className="text-text-secondary flex items-center gap-1.5 font-mono text-[11px]">
                            <Lock size={12} className="text-emerald-600 dark:text-emerald-400" />
                            {isGoogleConnection ? "Encrypted credential storage" : "Local credential storage"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs pt-2.5 border-t border-border/40">
                          <span className="text-text-muted font-medium">Scope</span>
                          <span className="text-text-secondary font-medium">
                            {isGoogleConnection ? "Selected during authorization" : "Configured plugin permissions"}
                          </span>
                        </div>
                      </div>

                      {isGoogleConnection && (
                        <p className="text-xs text-text-muted">
                          Disconnecting stops this plugin. To revoke Google account access, remove your OAuth app from
                          your Google Account connections. Reauthorize existing installations to apply service-specific
                          permissions.
                        </p>
                      )}
                      {/* Big Prominent Revoke Access Button */}
                      <div className="space-y-3 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleDisconnectPlugin(activeModalPlugin)}
                          className="w-full py-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-200 font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer group"
                        >
                          <Trash2
                            size={16}
                            className="text-rose-500 dark:text-rose-400 group-hover:scale-110 transition-transform"
                          />
                          <span>{isGoogleConnection ? "Disconnect plugin" : "Revoke Access & Disconnect"}</span>
                        </button>

                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={() => setShowReauthForm(true)}
                            className="text-xs text-text-muted hover:text-text-primary transition-colors underline"
                          >
                            Update credentials / Re-authenticate
                          </button>

                          <button
                            type="button"
                            onClick={handleCloseModal}
                            className="px-4 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                          >
                            Done
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* ========================================================= */
                /* 2. AUTHORIZATION / CONNECTION FLOW                         */
                /* ========================================================= */
                <>
                  {/* OAuth App Connection Visual (Sythoria <---> App) */}
                  <div className="px-6 pb-4 text-center">
                    <div className="flex items-center justify-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-[#141415] border border-border dark:border-white/10 flex items-center justify-center shadow-md p-1.5">
                        <SythoriaMark size={36} />
                      </div>

                      <div className="flex items-center gap-1 text-text-muted">
                        <span className="w-2 h-0.5 bg-border rounded" />
                        <span className="w-2 h-0.5 bg-border rounded" />
                        <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center text-accent">
                          <Shield size={13} />
                        </div>
                        <span className="w-2 h-0.5 bg-border rounded" />
                        <span className="w-2 h-0.5 bg-border rounded" />
                      </div>

                      <div className="w-12 h-12 rounded-2xl bg-[#141415] border border-border dark:border-white/10 flex items-center justify-center shadow-md p-2 relative">
                        <BrandIcon
                          name={activeModalPlugin.id}
                          iconUrl={activeModalPlugin.icon}
                          size={28}
                          showSparkle={
                            activeModalPlugin.id === "google-drive" ||
                            activeModalPlugin.id === "gmail" ||
                            activeModalPlugin.id === "google-calendar"
                          }
                        />
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold text-text-primary">Connect {activeModalPlugin.name}</h3>
                    <p className="text-xs text-text-muted mt-0.5">
                      {isGoogleConnection
                        ? "Choose access, then authorize in your browser."
                        : `Authorize access to your ${activeModalPlugin.name} account.`}
                    </p>
                  </div>

                  {/* Modal Body: Authorizing Permissions Box (ChatGPT Style) */}
                  <div className="px-6 py-3 space-y-4 overflow-y-auto flex-1 text-sm">
                    {!isGoogleConnection && (
                      <div className="p-4 rounded-xl border border-border/80 bg-hover/20 space-y-3.5">
                        <div className="text-xs font-semibold text-text-primary tracking-tight">
                          Authorizing allows this app to:
                        </div>

                        <div className="space-y-2.5 text-xs text-text-secondary">
                          <div className="flex items-start gap-2">
                            <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <span>Verify your {activeModalPlugin.name} identity</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <span>{activeModalPlugin.longDescription || activeModalPlugin.description}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <span>Act on your behalf via local Model Context Protocol tools</span>
                          </div>
                        </div>

                        {/* Resource Scopes */}
                        <div className="pt-3 border-t border-border/40">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
                            Resources on your account
                          </div>
                          <div className="flex items-center gap-2 text-xs text-text-primary bg-hover/40 px-2.5 py-1.5 rounded-lg border border-border/40">
                            <Sparkles size={14} className="text-accent shrink-0" />
                            <span className="font-medium">{activeModalPlugin.name} API & Toolsets</span>
                            <span className="text-[10px] text-text-muted ml-auto bg-surface px-1.5 py-0.5 rounded">
                              read & write
                            </span>
                          </div>
                        </div>

                        {/* Security & Privacy Guarantee */}
                        <div className="pt-2 flex items-start gap-2 text-[11px] text-text-muted leading-relaxed">
                          <Lock size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                          <span>
                            Credentials are stored locally. Connected services receive API requests, and tool results
                            may be sent to your selected AI provider.
                          </span>
                        </div>
                      </div>
                    )}

                    {/* GitHub 1-Click OAuth Integration */}
                    {activeModalPlugin.id === "github" && (
                      <div className="space-y-3 pt-1">
                        {githubOAuth.isActive ? (
                          <div className="p-4 rounded-xl border border-accent/40 bg-accent/10 space-y-3 text-center">
                            <div className="text-xs font-semibold text-text-primary">Enter this code on GitHub:</div>
                            <div className="flex items-center justify-center gap-3">
                              <span className="text-2xl font-mono font-bold tracking-widest text-accent bg-surface px-4 py-2 rounded-xl border border-accent/30 shadow-inner select-all">
                                {githubOAuth.userCode || "···· - ····"}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  if (githubOAuth.userCode) {
                                    void navigator.clipboard.writeText(githubOAuth.userCode);
                                    addToast("Code copied to clipboard!", "info");
                                  }
                                }}
                                className="p-2.5 rounded-xl bg-surface border border-border hover:bg-hover text-text-primary transition-colors cursor-pointer"
                                title="Copy Code"
                              >
                                <Copy size={16} />
                              </button>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              Your browser has opened to GitHub. Paste the code above and click{" "}
                              <strong>Authorize Sythoria</strong>.
                            </p>
                            {githubOAuth.isPolling ? (
                              <div className="flex items-center justify-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 font-medium pt-1">
                                <RefreshCw size={13} className="animate-spin" />
                                <span>Waiting for approval in browser...</span>
                              </div>
                            ) : githubOAuth.error ? (
                              <div className="space-y-2 pt-1">
                                <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                                  {githubOAuth.error}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleStartGitHubOAuth()}
                                  className="px-3 py-1 text-xs rounded-lg bg-accent text-accent-foreground font-medium hover:bg-accent/90 transition-colors"
                                >
                                  Try Again
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <button
                              type="button"
                              onClick={() => void handleStartGitHubOAuth()}
                              className="w-full py-3 rounded-xl bg-[#238636] hover:bg-[#2EA043] text-white font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2.5 group cursor-pointer"
                            >
                              <BrandIcon name="github" size={18} />
                              <span>1-Click Connect with GitHub</span>
                              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>

                            <div className="text-center">
                              <button
                                type="button"
                                onClick={() => setShowManualToken((prev) => !prev)}
                                className="text-[11px] text-text-muted hover:text-text-primary transition-colors underline"
                              >
                                {showManualToken
                                  ? "Switch back to 1-Click OAuth"
                                  : "Or enter a Personal Access Token manually"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Linear 1-Click PKCE OAuth Integration */}
                    {activeModalPlugin.id === "linear" && (
                      <div className="space-y-3 pt-1">
                        {linearOAuth.isConnecting ? (
                          <div className="p-4 rounded-xl border border-[#5E6AD2]/40 bg-[#5E6AD2]/10 space-y-3 text-center">
                            <div className="flex items-center justify-center gap-2 text-xs text-[#5E6AD2] font-semibold pt-1">
                              <RefreshCw size={15} className="animate-spin" />
                              <span>Waiting for authorization in browser...</span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              Your browser has opened to Linear. Click <strong>Authorize Sythoria</strong> to connect
                              your workspace.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (linearAbortRef.current) {
                                  linearAbortRef.current.abort();
                                  linearAbortRef.current = null;
                                }
                                setLinearOAuth({ isActive: false, isConnecting: false, error: null });
                              }}
                              className="text-[11px] text-text-muted hover:text-text-primary underline cursor-pointer"
                            >
                              Cancel connection
                            </button>
                          </div>
                        ) : linearOAuth.error ? (
                          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-2 text-center">
                            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                              {linearOAuth.error}
                            </div>
                            <div className="flex items-center justify-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => void handleStartLinearOAuth()}
                                className="px-3 py-1 text-xs rounded-lg bg-[#5E6AD2] hover:bg-[#6D79E0] text-white font-medium transition-colors"
                              >
                                Try Again
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowManualToken(true)}
                                className="px-3 py-1 text-xs rounded-lg bg-surface border border-border text-text-muted hover:text-text-primary transition-colors"
                              >
                                Enter API Key manually
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <button
                              type="button"
                              onClick={() => void handleStartLinearOAuth()}
                              className="w-full py-3 rounded-xl bg-[#5E6AD2] hover:bg-[#6D79E0] text-white font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2.5 group cursor-pointer"
                            >
                              <BrandIcon name="linear" size={18} />
                              <span>1-Click Connect with Linear</span>
                              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>

                            <div className="text-center">
                              <button
                                type="button"
                                onClick={() => setShowManualToken((prev) => !prev)}
                                className="text-[11px] text-text-muted hover:text-text-primary transition-colors underline"
                              >
                                {showManualToken
                                  ? "Switch back to 1-Click OAuth"
                                  : "Or enter a Personal API Key manually"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Google Desktop OAuth Integration (Google Drive, Google Calendar, Gmail) */}
                    {(activeModalPlugin.id === "google-drive" ||
                      activeModalPlugin.id === "google-calendar" ||
                      activeModalPlugin.id === "gmail") && (
                      <div className="space-y-3 pt-1">
                        {googleOAuth.isConnecting ? (
                          <div className="p-4 rounded-xl border border-blue-500/30 dark:border-blue-500/40 bg-blue-500/10 space-y-3 text-center">
                            <div className="flex items-center justify-center gap-2 text-xs text-blue-600 dark:text-blue-400 font-semibold pt-1">
                              <RefreshCw size={15} className="animate-spin" />
                              <span>Waiting for Google Authorization in browser...</span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              Your browser has opened to Google sign-in. Grant access to connect your account.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (googleAbortRef.current) {
                                  googleAbortRef.current.abort();
                                  googleAbortRef.current = null;
                                }
                                setGoogleOAuth({ isActive: false, isConnecting: false, error: null });
                              }}
                              className="text-[11px] text-text-muted hover:text-text-primary underline cursor-pointer"
                            >
                              Cancel connection
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {/* Step 1: Google OAuth Client Credentials Box */}
                            <div className="p-3 rounded-xl bg-surface/50 border border-border/60 space-y-2 text-left">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-semibold text-text-primary flex items-center gap-1.5">
                                  <Lock size={12} className="text-emerald-500 shrink-0" />
                                  <span>Set up Google credentials</span>
                                </span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void openExternalUrl("https://console.cloud.google.com/apis/credentials")
                                    }
                                    className="text-[11px] text-blue-500 hover:text-blue-400 font-medium cursor-pointer inline-flex items-center gap-1"
                                    title="Open Google Cloud Console Credentials in browser"
                                  >
                                    <ExternalLink size={11} />
                                    <span>Google Cloud setup</span>
                                  </button>
                                  <span className="text-border text-xs select-none">|</span>
                                  <label className="text-[11px] text-blue-500 hover:text-blue-400 font-medium cursor-pointer inline-flex items-center gap-1">
                                    <Upload size={11} />
                                    <span>Import JSON</span>
                                    <input
                                      type="file"
                                      accept=".json,application/json"
                                      className="hidden"
                                      onChange={handleImportGoogleCredentials}
                                    />
                                  </label>
                                </div>
                              </div>
                              <p className="text-xs text-text-muted leading-relaxed">
                                Create an OAuth client with type Desktop app in Google Cloud, enable the{" "}
                                {activeModalPlugin.id === "gmail"
                                  ? "Gmail API"
                                  : activeModalPlugin.id === "google-calendar"
                                    ? "Calendar API"
                                    : "Drive, Docs, Sheets, and Slides APIs"}
                                , and add your account as a test user if your app is in testing. Import the downloaded
                                JSON or enter the matching client ID and secret below. This setup is reused across
                                Google plugins.
                              </p>

                              <label className="block text-xs text-text-primary">
                                Google Client ID
                                <input
                                  aria-label="Google Client ID"
                                  value={formValues.GOOGLE_CLIENT_ID || ""}
                                  onChange={(event) =>
                                    setFormValues((prev) => ({ ...prev, GOOGLE_CLIENT_ID: event.target.value }))
                                  }
                                  placeholder="Your Desktop app client ID"
                                  disabled={googleClientLoading}
                                  className="mt-1 w-full px-3 py-1.5 rounded-lg bg-input border border-border"
                                />
                              </label>
                              {savedGoogleClientId && (
                                <p className="text-xs text-text-muted">
                                  Your Google OAuth client is encrypted and shared across Google plugins. Leave the
                                  secret blank to reuse it.
                                </p>
                              )}
                              <div className="relative">
                                <input
                                  aria-label="Google Client Secret"
                                  disabled={googleClientLoading}
                                  type={showPasswordMap["GOOGLE_CLIENT_SECRET"] ? "text" : "password"}
                                  value={formValues["GOOGLE_CLIENT_SECRET"] || ""}
                                  onChange={(e) =>
                                    setFormValues((prev) => ({ ...prev, GOOGLE_CLIENT_SECRET: e.target.value }))
                                  }
                                  placeholder="GOCSPX-... (From Google Cloud Console > Clients)"
                                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-input border border-border focus:border-focus focus:outline-none pr-8 text-text-primary placeholder:text-text-muted/60 font-mono"
                                />
                                <button
                                  type="button"
                                  aria-label={
                                    showPasswordMap.GOOGLE_CLIENT_SECRET ? "Hide client secret" : "Show client secret"
                                  }
                                  onClick={() =>
                                    setShowPasswordMap((prev) => ({
                                      ...prev,
                                      GOOGLE_CLIENT_SECRET: !prev["GOOGLE_CLIENT_SECRET"],
                                    }))
                                  }
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary cursor-pointer"
                                >
                                  {showPasswordMap["GOOGLE_CLIENT_SECRET"] ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                              </div>
                            </div>
                            {googleOAuth.error && (
                              <p role="alert" className="text-xs text-rose-600 dark:text-rose-400 leading-relaxed">
                                {googleOAuth.error}
                              </p>
                            )}

                            <div className="block text-xs text-text-primary">
                              Access
                              <Select
                                aria-label="Google access level"
                                value={googleAccess}
                                onChange={(value) => setGoogleAccess(value as GoogleAccess)}
                                options={[
                                  { value: "read", label: "Read only" },
                                  { value: "write", label: googlePermissions(activeModalPlugin.id).writeLabel },
                                ]}
                                size="compact"
                              />
                            </div>
                            <p className="text-xs text-text-muted">
                              {googlePermissions(activeModalPlugin.id, googleAccess).description}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Spotify 1-Click PKCE OAuth Integration */}
                    {activeModalPlugin.id === "spotify" && (
                      <div className="space-y-3 pt-1">
                        {spotifyOAuth.isConnecting ? (
                          <div className="p-4 rounded-xl border border-[#1DB954]/30 dark:border-[#1DB954]/40 bg-[#1DB954]/10 space-y-3 text-center">
                            <div className="flex items-center justify-center gap-2 text-xs text-[#1DB954] font-semibold pt-1">
                              <RefreshCw size={15} className="animate-spin" />
                              <span>Waiting for Spotify Authorization in browser...</span>
                            </div>
                            <p className="text-xs text-text-muted leading-relaxed">
                              Your browser has opened to Spotify sign-in. Grant access to connect your account.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                if (spotifyAbortRef.current) {
                                  spotifyAbortRef.current.abort();
                                  spotifyAbortRef.current = null;
                                }
                                setSpotifyOAuth({ isActive: false, isConnecting: false, error: null });
                              }}
                              className="text-[11px] text-text-muted hover:text-text-primary underline cursor-pointer"
                            >
                              Cancel connection
                            </button>
                          </div>
                        ) : spotifyOAuth.error ? (
                          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 space-y-2 text-center">
                            <div className="text-xs text-rose-600 dark:text-rose-400 font-medium">
                              {spotifyOAuth.error}
                            </div>
                            <div className="flex items-center justify-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => void handleStartSpotifyOAuth(activeModalPlugin)}
                                className="px-3 py-1 text-xs rounded-lg bg-[#1DB954] hover:bg-[#1AA34A] text-black font-semibold transition-colors cursor-pointer"
                              >
                                Try Again
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowManualToken(true)}
                                className="px-3 py-1 text-xs rounded-lg bg-surface border border-border text-text-muted hover:text-text-primary transition-colors cursor-pointer"
                              >
                                Enter Client ID manually
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <button
                              type="button"
                              onClick={() => void handleStartSpotifyOAuth(activeModalPlugin)}
                              className="w-full py-3 rounded-xl bg-[#1DB954] hover:bg-[#1AA34A] text-black font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2.5 group cursor-pointer"
                            >
                              <BrandIcon name="spotify" size={18} />
                              <span>1-Click Connect with Spotify</span>
                              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                            </button>

                            <div className="text-center">
                              <button
                                type="button"
                                onClick={() => setShowManualToken((prev) => !prev)}
                                className="text-[11px] text-text-muted hover:text-text-primary transition-colors underline cursor-pointer"
                              >
                                {showManualToken
                                  ? "Switch back to 1-Click OAuth"
                                  : "Or specify a custom Spotify Client ID"}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Input Fields (if service requires API token / OAuth Token and not in 1-Click mode) */}
                    {activeModalPlugin.authFields.length > 0 &&
                      ((activeModalPlugin.id !== "github" &&
                        activeModalPlugin.id !== "linear" &&
                        activeModalPlugin.id !== "google-drive" &&
                        activeModalPlugin.id !== "google-calendar" &&
                        activeModalPlugin.id !== "gmail" &&
                        activeModalPlugin.id !== "spotify") ||
                        (showManualToken &&
                          !githubOAuth.isActive &&
                          !linearOAuth.isConnecting &&
                          !googleOAuth.isConnecting &&
                          !spotifyOAuth.isConnecting)) && (
                        <div className="space-y-3 pt-1">
                          {activeModalPlugin.authFields.map((field) => {
                            const isPassword = field.type === "password";
                            const isVisible = showPasswordMap[field.key] || false;

                            return (
                              <div key={field.key} className="space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label className="text-xs font-medium text-text-primary">
                                    {field.label}
                                    {field.required && <span className="text-accent ml-1">*</span>}
                                  </label>
                                  {field.docUrl && (
                                    <a
                                      href={field.docUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[11px] text-accent hover:underline flex items-center gap-1"
                                    >
                                      <span>Get token in browser</span>
                                      <ExternalLink size={10} />
                                    </a>
                                  )}
                                </div>

                                <div className="relative">
                                  <input
                                    type={isPassword && !isVisible ? "password" : "text"}
                                    value={formValues[field.key] || ""}
                                    onChange={(e) =>
                                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                                    }
                                    placeholder={field.placeholder}
                                    className="w-full px-3 py-2 text-xs rounded-lg border border-input-border bg-input text-text-primary placeholder-text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none pr-8 font-mono"
                                  />
                                  {isPassword && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setShowPasswordMap((prev) => ({
                                          ...prev,
                                          [field.key]: !prev[field.key],
                                        }))
                                      }
                                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                                    >
                                      {isVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                  )}
                                </div>

                                {field.helpText && <p className="text-[11px] text-text-muted">{field.helpText}</p>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </div>

                  {/* Modal Footer (ChatGPT Authorize Buttons) */}
                  <div className="p-5 border-t border-border/60 bg-hover/10 space-y-2">
                    {isGoogleConnection && !googleOAuth.isConnecting && (
                      <button
                        type="button"
                        onClick={() => void handleStartGoogleOAuth(activeModalPlugin)}
                        disabled={googleClientLoading}
                        className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer group"
                      >
                        <span>Continue with Google</span>
                        <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                      </button>
                    )}
                    {/* Generic Authorize Button (shown if not in 1-click active state) */}
                    {!githubOAuth.isActive &&
                      !linearOAuth.isConnecting &&
                      !googleOAuth.isConnecting &&
                      !spotifyOAuth.isConnecting &&
                      ((activeModalPlugin.id !== "github" &&
                        activeModalPlugin.id !== "linear" &&
                        activeModalPlugin.id !== "google-drive" &&
                        activeModalPlugin.id !== "google-calendar" &&
                        activeModalPlugin.id !== "gmail" &&
                        activeModalPlugin.id !== "spotify") ||
                        showManualToken) && (
                        <button
                          onClick={() => void handleConnectPlugin()}
                          disabled={isSubmitting}
                          className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                        >
                          {isSubmitting ? (
                            <>
                              <RefreshCw size={14} className="animate-spin" />
                              <span>Authorizing...</span>
                            </>
                          ) : (
                            <>
                              <span>Authorize {activeModalPlugin.name}</span>
                              <ArrowRight size={14} />
                            </>
                          )}
                        </button>
                      )}

                    <div className="flex items-center justify-between pt-1">
                      {installedPluginMap.has(activeModalPlugin.id) ? (
                        <button
                          type="button"
                          onClick={() => setShowReauthForm(false)}
                          className="px-2.5 py-1 text-xs text-text-muted hover:text-text-primary transition-colors flex items-center gap-1 font-medium"
                        >
                          ← Back to Connected View
                        </button>
                      ) : (
                        <div />
                      )}

                      <button
                        onClick={handleCloseModal}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
