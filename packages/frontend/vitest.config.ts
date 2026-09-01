import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const reactPlugin = react();

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [reactPlugin],
        resolve: {
          alias: { '@': path.resolve(dirname) },
        },
        test: {
          name: 'unit',
          environment: 'jsdom',
          globals: true,
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
      {
        plugins: [reactPlugin],
        resolve: {
          alias: { '@': path.resolve(dirname) },
        },
        test: {
          name: 'e2e',
          environment: 'jsdom',
          globals: true,
          include: ['tests/e2e/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
