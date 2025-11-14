import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'PAMP-WATCH-PXI/**', // Ignore archived copy inside repo to avoid duplicate suites
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'config.ts',
        'validator.ts',
        'db.ts',
        'shared/**/*.ts',
        'clients/**/*.ts',
      ],
      exclude: [
        'node_modules/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'components/**',
        '*.tsx',
      ],
    },
  },
});
