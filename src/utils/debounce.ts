/**
 * Creates a debounced function that delays invoking `fn` until after `delay` milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * Provides a `.cancel()` method to cancel any pending invocations.
 */
export function debounce<TArgs extends unknown[], TResult>(fn: (...args: TArgs) => TResult, delay: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = function (...args: TArgs) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, delay);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return debounced;
}
