import type { PropsWithChildren } from "react";
import { MotionConfig } from "motion/react";
import { useUIStore } from "../store/useUIStore";

export function AppMotionConfig({ children }: PropsWithChildren) {
  const animationsDisabled = useUIStore((state) => state.animationsDisabled);

  return <MotionConfig reducedMotion={animationsDisabled ? "always" : "user"}>{children}</MotionConfig>;
}
