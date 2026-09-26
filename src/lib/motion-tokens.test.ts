import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUIStore } from "../store/useUIStore";
import {
  getMotionMode,
  motionTokens,
  motionTransitions,
  REDUCED_MOTION_QUERY,
  shouldReduceMotion,
  springs,
} from "./motion-tokens";

const originalMatchMedia = window.matchMedia;

function mockReducedMotion(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === REDUCED_MOTION_QUERY ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("motion tokens", () => {
  beforeEach(() => {
    useUIStore.setState({ animationsDisabled: false });
    mockReducedMotion(false);
  });

  afterEach(() => {
    useUIStore.setState({ animationsDisabled: false });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  });

  it("uses normal animation values when reduced motion is not requested", () => {
    expect(getMotionMode()).toBe("full");
    expect(shouldReduceMotion()).toBe(false);
    expect(motionTokens.duration.feedback).toBe(0.16);
    expect(motionTokens.duration.popover).toBe(0.28);
    expect(motionTokens.duration.panel).toBe(0.42);
    expect(motionTokens.distance.md).toBe(14);
    expect(motionTokens.scale.pop).toBe(1.015);
    expect(springs.snappy).toEqual({ type: "spring", visualDuration: 0.16, bounce: 0.06 });
    expect(motionTransitions.popoverEnter).toEqual({
      type: "tween",
      duration: 0.28,
      ease: motionTokens.easing.enter,
    });
  });

  it("keeps a short opacity transition while removing spatial reduced motion", () => {
    mockReducedMotion(true);

    expect(getMotionMode()).toBe("reduced");
    expect(shouldReduceMotion()).toBe(true);
    expect(motionTokens.duration.fast).toBe(0.16);
    expect(motionTokens.distance.md).toBe(0);
    expect(motionTokens.scale.pop).toBe(1);
    expect(springs.snappy).toEqual({
      type: "tween",
      duration: 0.16,
      ease: motionTokens.easing.standard,
    });
    expect(motionTransitions.panelEnter).toEqual({
      type: "tween",
      duration: 0.16,
      ease: motionTokens.easing.enter,
    });
  });

  it("fully disables motion through the in-app animation preference", () => {
    useUIStore.setState({ animationsDisabled: true });

    expect(getMotionMode()).toBe("off");
    expect(shouldReduceMotion()).toBe(true);
    expect(motionTokens.duration.normal).toBe(0);
    expect(motionTokens.distance.md).toBe(0);
    expect(motionTokens.scale.press).toBe(1);
    expect(springs.gentle).toEqual({ type: "tween", duration: 0 });
    expect(motionTransitions.modalEnter).toEqual({ type: "tween", duration: 0 });
  });
});
