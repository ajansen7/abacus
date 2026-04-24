// Flat-config ESLint 9. Minimal in M0; tightens in later milestones.
export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'runtime/**'],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },
];
