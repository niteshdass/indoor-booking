import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '.superpowers/**', '**/.vercel/**', 'apps/mobile/.expo/**', 'apps/mobile/android/**', 'apps/mobile/ios/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/mobile/test/globalSetup.js'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', process: 'readonly' } },
  },
);
