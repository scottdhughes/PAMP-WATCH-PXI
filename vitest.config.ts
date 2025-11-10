import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
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
