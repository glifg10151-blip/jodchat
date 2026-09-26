export function elapsedSeconds(startTimestamp: number, endTimestamp = Date.now()): number {
  return Math.max(0, endTimestamp - startTimestamp) / 1000;
}

export function formatElapsedDuration(totalSeconds: number): string {
  const clampedSeconds = Math.max(0, totalSeconds);

  if (clampedSeconds < 1) {
    const milliseconds = Math.min(999, Math.round(clampedSeconds * 1000));
    return `${milliseconds}ms`;
  }

  const wholeSeconds = Math.floor(clampedSeconds);
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (minutes === 0) return `${remainingSeconds}s`;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}
