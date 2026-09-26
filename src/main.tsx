import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppMotionConfig } from "./components/AppMotionConfig";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
const isMac = window.navigator.userAgent.includes("Mac");
const isWindows = window.navigator.userAgent.includes("Windows");

document.documentElement.classList.toggle("platform-macos", isMac);
document.documentElement.classList.toggle("platform-windows", isWindows);

if (prefersDark) {
  document.documentElement.classList.add("dark");
} else {
  document.documentElement.classList.remove("dark");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppMotionConfig>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AppMotionConfig>
  </React.StrictMode>,
);
