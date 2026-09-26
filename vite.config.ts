import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

function bundleBudgetPlugin(): Plugin {
  return {
    name: "sythoria-bundle-budgets",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const limit = output.name === "markdown" ? 500 * 1024 : output.isEntry ? 650 * 1024 : null;
        if (limit !== null && output.code.length > limit) {
          this.error(
            `Bundle budget exceeded for ${output.fileName}: ${Math.ceil(output.code.length / 1024)} KiB > ${limit / 1024} KiB`,
          );
        }
      }
    },
  };
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), bundleBudgetPlugin()],

  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    target: ["es2021", "chrome105", "safari15"],
    minify: "oxc",
    cssMinify: true,
    sourcemap: false,

    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("highlight.js/lib/languages/")) {
            return undefined;
          }

          if (
            id.includes("react-markdown") ||
            id.includes("remark-gfm") ||
            id.includes("remark-math") ||
            id.includes("rehype-katex") ||
            id.includes("lowlight") ||
            id.includes("highlight.js/lib/core") ||
            id.includes("micromark") ||
            id.includes("unified") ||
            id.includes("unist") ||
            id.includes("vfile") ||
            id.includes("mdast")
          ) {
            return "markdown";
          }

          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react";
          }

          if (id.includes("zustand") || id.includes("zod") || id.includes("lucide-react")) {
            return "vendor";
          }
        },
      },
    },
  },
}));
