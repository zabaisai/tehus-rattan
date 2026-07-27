import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest.config.ts does not set `globals: true`, so React Testing Library's
// automatic afterEach(cleanup) never registers on its own — without this,
// every test in a file keeps piling DOM nodes from the previous ones.
afterEach(() => {
  cleanup();
});
