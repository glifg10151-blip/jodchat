import { useUIStore } from "../store/useUIStore";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type MotionMode = "full" | "reduced" | "off";

export function getMotionMode(): MotionMode {
  if (useUIStore.getState().animationsDisabled) return "off";

  const systemPrefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;

  return systemPrefersReducedMotion ? "reduced" : "full";
}

export function shouldReduceMotion() {
  return getMotionMode() !== "full";
}

const FULL_DURATIONS = {
  feedback: 0.16,
  hover: 0.2,
  popover: 0.28,
  content: 0.34,
  modal: 0.36,
  panel: 0.42,
  expressive: 0.55,
  ambient: 2.2,
} as const;

const REDUCED_DURATION = 0.16;

function durationFor(value: number) {
  const mode = getMotionMode();
  if (mode === "off") return 0;
  if (mode === "reduced") return REDUCED_DURATION;
  return value;
}

export const motionTokens = {
  get duration() {
    return {
      feedback: durationFor(FULL_DURATIONS.feedback),
      hover: durationFor(FULL_DURATIONS.hover),
      popover: durationFor(FULL_DURATIONS.popover),
      content: durationFor(FULL_DURATIONS.content),
      modal: durationFor(FULL_DURATIONS.modal),
      panel: durationFor(FULL_DURATIONS.panel),
      expressive: durationFor(FULL_DURATIONS.expressive),
      ambient: durationFor(FULL_DURATIONS.ambient),
      // Compatibility aliases. New motion should use the semantic names above.
      instant: durationFor(FULL_DURATIONS.feedback),
      fast: durationFor(FULL_DURATIONS.hover),
      normal: durationFor(FULL_DURATIONS.content),
      slow: durationFor(FULL_DURATIONS.panel),
      crawl: durationFor(FULL_DURATIONS.expressive),
    };
  },
  easing: {
    standard: [0.2, 0, 0.2, 1] as [number, number, number, number],
    enter: [0.2, 0.45, 0.25, 1] as [number, number, number, number],
    exit: [0.4, 0, 0.8, 0.2] as [number, number, number, number],
    ambient: [0.4, 0, 0.6, 1] as [number, number, number, number],
    smooth: [0.2, 0, 0.2, 1] as [number, number, number, number],
    sharp: [0.4, 0, 0.8, 0.2] as [number, number, number, number],
    bounce: [0.2, 0.45, 0.25, 1] as [number, number, number, number],
    linear: [0, 0, 1, 1] as [number, number, number, number],
  },
  get distance() {
    const includeTransform = getMotionMode() === "full";
    return {
      xs: includeTransform ? 4 : 0,
      sm: includeTransform ? 8 : 0,
      md: includeTransform ? 14 : 0,
      lg: includeTransform ? 20 : 0,
      xl: includeTransform ? 40 : 0,
    };
  },
  get scale() {
    const includeTransform = getMotionMode() === "full";
    return {
      subtle: includeTransform ? 0.98 : 1,
      press: includeTransform ? 0.975 : 1,
      pop: includeTransform ? 1.015 : 1,
    };
  },
};

function reducedTransition() {
  return getMotionMode() === "off"
    ? { type: "tween" as const, duration: 0 }
    : {
        type: "tween" as const,
        duration: REDUCED_DURATION,
        ease: motionTokens.easing.standard,
      };
}

function durationSpring(visualDuration: number, bounce: number) {
  return getMotionMode() === "full" ? { type: "spring" as const, visualDuration, bounce } : reducedTransition();
}

export const springs = {
  get snappy() {
    return durationSpring(FULL_DURATIONS.feedback, 0.06);
  },
  get gentle() {
    return durationSpring(FULL_DURATIONS.content, 0.04);
  },
  get bouncy() {
    return durationSpring(FULL_DURATIONS.expressive, 0.16);
  },
  get instant() {
    return durationSpring(0.14, 0.04);
  },
  get release() {
    return durationSpring(FULL_DURATIONS.panel, 0);
  },
};

function tween(duration: number, ease: [number, number, number, number]) {
  if (getMotionMode() === "off") return { type: "tween" as const, duration: 0 };
  return {
    type: "tween" as const,
    duration: getMotionMode() === "reduced" ? REDUCED_DURATION : duration,
    ease,
  };
}

export const motionTransitions = {
  get feedback() {
    return tween(FULL_DURATIONS.feedback, motionTokens.easing.standard);
  },
  get hover() {
    return tween(FULL_DURATIONS.hover, motionTokens.easing.standard);
  },
  get popoverEnter() {
    return tween(FULL_DURATIONS.popover, motionTokens.easing.enter);
  },
  get popoverExit() {
    return tween(0.19, motionTokens.easing.exit);
  },
  get content() {
    return tween(FULL_DURATIONS.content, motionTokens.easing.standard);
  },
  get modalEnter() {
    return tween(FULL_DURATIONS.modal, motionTokens.easing.enter);
  },
  get modalExit() {
    return tween(0.24, motionTokens.easing.exit);
  },
  get panelEnter() {
    return tween(FULL_DURATIONS.panel, motionTokens.easing.enter);
  },
  get panelExit() {
    return tween(0.3, motionTokens.easing.exit);
  },
  get expressive() {
    return tween(FULL_DURATIONS.expressive, motionTokens.easing.enter);
  },
};
