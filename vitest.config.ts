import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'shared/**/*.test.ts',
      'src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
  },
});
