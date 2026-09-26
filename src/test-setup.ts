import "@testing-library/jest-dom/vitest";

HTMLElement.prototype.scrollIntoView = function () {};

window.scrollTo = function () {};

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;
