import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/client/**/*.test.tsx'],
          setupFiles: ['tests/client/setup.ts'],
          css: false,
          server: { deps: { inline: [/@primer\/react/, /@primer\/primitives/] } },
        },
      },
    ],
  },
});
