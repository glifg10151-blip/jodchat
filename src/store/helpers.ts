import React from "react";
import { useUIStore, ThemeConfig } from "./useUIStore";
import { useModelStore } from "./useModelStore";
import { useSearchStore } from "./useSearchStore";
import { useMcpStore } from "./useMcpStore";
import { applyTheme } from "../config/themePresets";

export function uiToast(message: React.ReactNode, variant: "info" | "success" | "error" = "info") {
  useUIStore.getState().addToast(message, variant);
}

export function uiLoading(
  key: "init" | "sendMessage" | "checkConnection" | "saveConfig" | "toolExecution" | "mcpConnect",
  value: boolean,
) {
  useUIStore.getState().setLoading(key, value);
}

export function uiConfigLoaded(loaded: boolean) {
  useUIStore.getState().setConfigLoaded(loaded);
}

export function uiHasStarted(started: boolean) {
  useUIStore.getState().setHasStarted(started);
}

export function uiLaunchReady(ready: boolean) {
  useUIStore.getState().setLaunchReady(ready);
}

export function uiTheme(theme: ThemeConfig) {
  useUIStore.setState({ theme });
  applyTheme(theme);
}

export function uiSidebarOpen(open: boolean) {
  useUIStore.getState().setSidebarOpen(open);
}

export function uiView(view: "chat" | "settings") {
  useUIStore.getState().setView(view);
}

export function uiCloseRenameModal() {
  useUIStore.getState().closeRenameModal();
}

export function modelCancelStream() {
  return useModelStore.getState().cancelActiveStream();
}

export function modelStopHealthCheck() {
  useModelStore.getState().stopHealthCheck();
}

export function modelReleaseListeners() {
  useModelStore.getState().releaseStreamListeners();
}

export function modelCheckConnections(modelIds?: string[]) {
  return useModelStore.getState().checkModelConnections(modelIds);
}

export function modelStartHealthCheck() {
  useModelStore.getState().startHealthCheck();
}

export function modelSetActiveStream(streamId: string | null, convId: string | null) {
  useModelStore.getState().setActiveStreamId(streamId, convId);
}

export function modelGetActiveStreamId() {
  return useModelStore.getState().getActiveStreamId();
}

export type ModelState = ReturnType<typeof useModelStore.getState>;
export type SearchState = ReturnType<typeof useSearchStore.getState>;
export type McpState = ReturnType<typeof useMcpStore.getState>;

export function modelSetState(partial: Partial<ModelState>) {
  useModelStore.setState(partial);
}

export function searchSetState(partial: Partial<SearchState>) {
  useSearchStore.setState(partial);
}

export function searchPerformSearch(...args: Parameters<SearchState["performSearch"]>) {
  return useSearchStore.getState().performSearch(...args);
}

export function searchFetchUrlContent(...args: Parameters<SearchState["fetchUrlContent"]>) {
  return useSearchStore.getState().fetchUrlContent(...args);
}

export function searchCheckConnections() {
  const state = useSearchStore.getState();
  return Promise.all([state.checkSearchConnections(), state.checkFetchConnections()]);
}

export function searchStartConnectionChecks() {
  useSearchStore.getState().startConnectionChecks();
}

export function searchStopConnectionChecks() {
  useSearchStore.getState().stopConnectionChecks();
}

export function mcpSetState(partial: Partial<McpState>) {
  useMcpStore.setState(partial);
}
