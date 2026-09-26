import { CustomThemeConfig } from "./themePresets";

export interface MarketplaceTheme {
  id: string;
  name: string;
  type: "light" | "dark";
  description: string;
  author: string;
  config: CustomThemeConfig;
}

export const MARKETPLACE_THEMES: MarketplaceTheme[] = [
  // Dark Themes
  {
    id: "github-dark",
    name: "GitHub Dark",
    type: "dark",
    description: "Classic GitHub Dark theme for a focused coding experience.",
    author: "GitHub",
    config: {
      preset: "GitHub Dark",
      background: "#0d1117",
      foreground: "#c9d1d9",
      accent: "#58a6ff",
    },
  },
  {
    id: "night-owl",
    name: "Night Owl",
    type: "dark",
    description: "A dark theme for night owls out there.",
    author: "Sarah Drasner",
    config: {
      preset: "Night Owl",
      background: "#011627",
      foreground: "#d6deeb",
      accent: "#82aaff",
    },
  },
  {
    id: "synthwave-84",
    name: "SynthWave '84",
    type: "dark",
    description: "Do you remember that endless summer back in '84? Neon colors all around.",
    author: "Robb Owen",
    config: {
      preset: "SynthWave '84",
      background: "#26233a",
      foreground: "#f92aad",
      accent: "#36f9f6",
    },
  },
  {
    id: "ayu-dark",
    name: "Ayu Dark",
    type: "dark",
    description: "A simple theme with bright colors.",
    author: "Teo",
    config: {
      preset: "Ayu Dark",
      background: "#0f1419",
      foreground: "#b3b1ad",
      accent: "#ffb454",
    },
  },
  {
    id: "nord",
    name: "Nord",
    type: "dark",
    description: "An arctic, north-bluish clean and elegant theme.",
    author: "Arctic Ice Studio",
    config: {
      preset: "Nord",
      background: "#2e3440",
      foreground: "#d8dee9",
      accent: "#88c0d0",
    },
  },
  {
    id: "cobalt2",
    name: "Cobalt2",
    type: "dark",
    description: "Vibrant blue and yellow theme designed by Wes Bos.",
    author: "Wes Bos",
    config: {
      preset: "Cobalt2",
      background: "#193549",
      foreground: "#e1efff",
      accent: "#ffc600",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    type: "dark",
    description: "Retro groove color scheme with a warm, comforting vibe.",
    author: "morhetz",
    config: {
      preset: "Gruvbox Dark",
      background: "#282828",
      foreground: "#ebdbb2",
      accent: "#fe8019",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    type: "dark",
    description: "All natural pine, moody rosemary and bright gold colors.",
    author: "Rosé Pine",
    config: {
      preset: "Rosé Pine",
      background: "#191724",
      foreground: "#e0def4",
      accent: "#ebbcba",
    },
  },
  {
    id: "vesper",
    name: "Vesper",
    type: "dark",
    description: "A clean, dark theme with high contrast orange accent.",
    author: "raunofreiberg",
    config: {
      preset: "Vesper",
      background: "#101010",
      foreground: "#e0e0e0",
      accent: "#ff7c30",
    },
  },
  {
    id: "andromeda",
    name: "Andromeda",
    type: "dark",
    description: "Dark theme with a vibrant space-inspired neon palette.",
    author: "Eliver Lara",
    config: {
      preset: "Andromeda",
      background: "#23262e",
      foreground: "#e3e4e6",
      accent: "#00e8c6",
    },
  },
  {
    id: "shades-of-purple",
    name: "Shades of Purple",
    type: "dark",
    description: "A professional theme with hand-picked shades of purple.",
    author: "Ahmad Awais",
    config: {
      preset: "Shades of Purple",
      background: "#2d2b55",
      foreground: "#f1efff",
      accent: "#ff9d00",
    },
  },

  // Light Themes
  {
    id: "github-light",
    name: "GitHub Light",
    type: "light",
    description: "Clean and bright GitHub Light theme.",
    author: "GitHub",
    config: {
      preset: "GitHub Light",
      background: "#ffffff",
      foreground: "#24292f",
      accent: "#0969da",
    },
  },
  {
    id: "quiet-light",
    name: "Quiet Light",
    type: "light",
    description: "A comfortable light theme for long coding sessions.",
    author: "Ian Hill",
    config: {
      preset: "Quiet Light",
      background: "#f5f5f5",
      foreground: "#333333",
      accent: "#705697",
    },
  },
  {
    id: "ayu-light",
    name: "Ayu Light",
    type: "light",
    description: "A simple and bright theme for your eyes.",
    author: "Teo",
    config: {
      preset: "Ayu Light",
      background: "#fafafa",
      foreground: "#5c6166",
      accent: "#ff9940",
    },
  },
  {
    id: "solarized-light-custom",
    name: "Solarized Clean",
    type: "light",
    description: "A modern take on the classic Solarized Light.",
    author: "Ethan Schoonover",
    config: {
      preset: "Solarized Clean",
      background: "#fdf6e3",
      foreground: "#657b83",
      accent: "#268bd2",
    },
  },
  {
    id: "bluloco-light",
    name: "Bluloco Light",
    type: "light",
    description: "A fancy light theme with good contrast and readable colors.",
    author: "Umut Topuzoğlu",
    config: {
      preset: "Bluloco Light",
      background: "#f9f9f9",
      foreground: "#383a42",
      accent: "#ce2258",
    },
  },
  {
    id: "nord-light",
    name: "Nord Light",
    type: "light",
    description: "Light variant of the arctic, elegant Nord color scheme.",
    author: "Arctic Ice Studio",
    config: {
      preset: "Nord Light",
      background: "#e5e9f0",
      foreground: "#2e3440",
      accent: "#88c0d0",
    },
  },
  {
    id: "rose-pine-dawn",
    name: "Rosé Pine Dawn",
    type: "light",
    description: "All natural pine, moody rosemary and bright gold colors in light mode.",
    author: "Rosé Pine",
    config: {
      preset: "Rosé Pine Dawn",
      background: "#faf4ed",
      foreground: "#575279",
      accent: "#d7827e",
    },
  },
  {
    id: "gruvbox-light",
    name: "Gruvbox Light",
    type: "light",
    description: "Warm retro groove color palette for bright environments.",
    author: "morhetz",
    config: {
      preset: "Gruvbox Light",
      background: "#fbf1c7",
      foreground: "#3c3836",
      accent: "#af3a03",
    },
  },
  {
    id: "tokyo-night-light",
    name: "Tokyo Night Light",
    type: "light",
    description: "A clean, light theme that matches Tokyo Night's aesthetic.",
    author: "folke",
    config: {
      preset: "Tokyo Night Light",
      background: "#e1e2e7",
      foreground: "#3760bf",
      accent: "#3854d1",
    },
  },
];
