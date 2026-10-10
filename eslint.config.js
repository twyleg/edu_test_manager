import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      curly: ['error', 'all'],
      'one-var': ['error', 'never'],
      'max-statements-per-line': ['error', { max: 1 }],
      'no-sequences': 'error',
    },
  },
];
