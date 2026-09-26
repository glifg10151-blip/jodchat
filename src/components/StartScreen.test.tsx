import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { MotionConfig } from "motion/react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_CONFIG } from "../config/themePresets";
import { useModelStore } from "../store/useModelStore";
import { useUIStore } from "../store/useUIStore";
import type { ModelConfig } from "../types";
import StartScreen from "./StartScreen";

const originalSetLanguage = useUIStore.getState().setLanguage;
const originalSetTheme = useUIStore.getState().setTheme;
const originalUpdateModels = useModelStore.getState().updateModels;
const originalPersistApiKeys = useModelStore.getState().persistApiKeys;

describe("StartScreen", () => {
  beforeEach(() => {
    useUIStore.setState({
      animationsDisabled: true,
      language: "en",
      theme: DEFAULT_THEME_CONFIG,
      setLanguage: vi.fn((language: string) => useUIStore.setState({ language })),
      setTheme: vi.fn((theme) => useUIStore.setState({ theme })),
    });
    useModelStore.setState({
      models: [],
      selectedModel: "",
      apiKeys: {},
      updateModels: vi.fn((models: ModelConfig[]) => {
        useModelStore.setState({
          models,
          selectedModel: models[0]?.id ?? "",
          apiKeys: Object.fromEntries(models.filter((model) => model.apiKey).map((model) => [model.id, model.apiKey])),
        });
      }),
      persistApiKeys: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterAll(() => {
    useUIStore.setState({ setLanguage: originalSetLanguage, setTheme: originalSetTheme });
    useModelStore.setState({ updateModels: originalUpdateModels, persistApiKeys: originalPersistApiKeys });
  });

  it("opens directly to the language dialog when motion is disabled", () => {
    render(<StartScreen onStart={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Choose your language" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Welcome to Sythoria")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
  });

  it("keeps every setup dialog free of detectable accessibility violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<StartScreen onStart={vi.fn()} />);
    expect((await axe.run(container)).violations).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect((await axe.run(container)).violations).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect((await axe.run(container)).violations).toEqual([]);
  });

  it("updates the onboarding copy when a language is selected", async () => {
    const user = userEvent.setup();
    render(<StartScreen onStart={vi.fn()} />);

    await user.click(screen.getByRole("radio", { name: /Español/ }));

    expect(screen.getByRole("dialog", { name: "Elige tu idioma" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Español/ })).toHaveAttribute("aria-checked", "true");
    expect(useUIStore.getState().language).toBe("es");
  });

  it("supports arrow-key language selection and advances with localized copy", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<StartScreen onStart={onStart} />);

    fireEvent.keyDown(screen.getByRole("radio", { name: /English/ }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /Español/ })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("dialog", { name: "Elige tu tema" })).toBeInTheDocument();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("applies a theme and saves the first model before finishing", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<StartScreen onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("dialog", { name: "Choose your theme" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Dark/ }));
    expect(useUIStore.getState().theme.mode).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("dialog", { name: "Set up your first model" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("API Key"), "sk-onboarding-test");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));

    expect(onStart).toHaveBeenCalledOnce();
    expect(useModelStore.getState().models).toEqual([
      expect.objectContaining({
        provider: "openai",
        apiBase: "https://api.openai.com/v1/chat/completions",
        apiKey: "sk-onboarding-test",
        modelId: "gpt-5.6-sol",
        enabled: true,
      }),
    ]);
    expect(useModelStore.getState().persistApiKeys).toHaveBeenCalledOnce();
  });

  it("allows model setup to be deferred", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<StartScreen onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Set up later" }));

    expect(onStart).toHaveBeenCalledOnce();
    expect(useModelStore.getState().models).toEqual([]);
  });

  it("still shows the handwritten welcome when the system requests reduced motion", () => {
    useUIStore.setState({ animationsDisabled: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    render(<StartScreen onStart={vi.fn()} />);

    expect(screen.getByLabelText("Welcome to Sythoria")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the reduced-motion welcome visible instead of collapsing into a blink", () => {
    vi.useFakeTimers();
    useUIStore.setState({ animationsDisabled: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    const { unmount } = render(
      <MotionConfig reducedMotion="always">
        <StartScreen onStart={vi.fn()} />
      </MotionConfig>,
    );

    try {
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.getByLabelText("Welcome to Sythoria")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

  it("starts with the handwritten welcome when full motion is available", () => {
    useUIStore.setState({ animationsDisabled: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });

    const { container } = render(<StartScreen onStart={vi.fn()} />);

    expect(screen.getByLabelText("Welcome to Sythoria")).toBeInTheDocument();
    expect(container.querySelector("svg text")).toHaveTextContent("Welcome");
    expect(container.querySelector("svg text")).toHaveStyle({
      fontFamily: '"Segoe Script", "Snell Roundhand", "Bradley Hand", "Brush Script MT", cursive',
      fontWeight: "700",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
