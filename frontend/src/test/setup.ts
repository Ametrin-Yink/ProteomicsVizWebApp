import '@testing-library/jest-dom/vitest';

// React 19 requires test environments that call act() directly to opt in.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;
