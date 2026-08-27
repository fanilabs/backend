// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

/**
 * Architecture boundary map. Mirrors ARCHITECTURE.md §1/§10: domain has zero
 * outward dependencies, application may only depend on its own module's
 * domain plus shared/blockchain, infrastructure implements domain ports,
 * interface only talks to its own module's application layer, and no module
 * may reach into another module's domain/infrastructure directly.
 */
const moduleElementTypes = [
  { type: 'domain', pattern: 'src/modules/*/domain/**' },
  { type: 'application', pattern: 'src/modules/*/application/**' },
  { type: 'infrastructure', pattern: 'src/modules/*/infrastructure/**' },
  { type: 'interface', pattern: 'src/modules/*/interface/**' },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        ...moduleElementTypes.map((el) => ({ ...el, capture: ['module'] })),
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'blockchain', pattern: 'src/blockchain/**' },
        { type: 'bootstrap', pattern: 'src/@(app|server).ts', mode: 'file' },
        { type: 'workers', pattern: 'src/workers/**' },
        // The module composition root (src/modules/<name>/index.ts) is the
        // one place per module allowed to see all four of its own layers —
        // it wires infrastructure adapters into application use cases and
        // hands the interface layer a ready-to-register Fastify plugin.
        { type: 'module-root', pattern: 'src/modules/*/index.ts', mode: 'file' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // domain may depend on the shared *error hierarchy* only (pure
            // TS, no framework/infra coupling) — see src/shared/errors —
            // so domain errors can extend AppError and be caught uniformly
            // by the Fastify error handler without domain knowing Fastify
            // exists. Domain code must import shared/errors/app-error.js
            // directly, not the shared/errors barrel, to avoid pulling in
            // the Fastify-typed error-handler module even at the type level.
            { from: 'domain', allow: ['domain', 'shared'] },
            { from: 'application', allow: ['domain', 'application', 'shared'] },
            {
              from: 'infrastructure',
              allow: ['domain', 'application', 'infrastructure', 'shared', 'blockchain'],
            },
            { from: 'interface', allow: ['application', 'domain', 'shared'] },
            {
              from: 'module-root',
              allow: [
                'domain',
                'application',
                'infrastructure',
                'interface',
                'shared',
                'blockchain',
              ],
            },
            {
              from: ['bootstrap', 'workers'],
              allow: ['shared', 'blockchain', 'module-root'],
            },
            { from: 'shared', allow: ['shared'] },
            { from: 'blockchain', allow: ['blockchain', 'shared'] },
          ],
        },
      ],
      'boundaries/no-private': ['error'],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
