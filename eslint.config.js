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

// Layers that are internal to a module: importing these from a *different*
// module is a boundary violation even when the layer type is otherwise
// allowed. Own-module imports stay valid via the `module` capture match.
const internalLayers = ['domain', 'infrastructure'];

/**
 * Build an element-types rule that allows the given layer types but only
 * when they belong to the same module (captured as `module`). Shared,
 * blockchain, bootstrap, workers and module-root elements carry no module
 * capture, so they are matched by type alone.
 */
const ownModuleRule = (from, allow) => ({
  from,
  allow: allow.map((type) =>
    internalLayers.includes(type)
      ? { type, module: '${from.module}' }
      : { type },
  ),
});

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
        { type: 'module-root', pattern: 'src/modules/*/index.ts', mode: 'file', capture: ['module'] },
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
            // The narrow shared exception is enforced by the restricted
            // import rule below; here we only allow own-module domain.
            { from: 'domain', allow: [{ type: 'domain', module: '${from.module}' }, { type: 'shared' }] },
            ownModuleRule('application', ['domain', 'application', 'shared']),
            ownModuleRule('infrastructure', [
              'domain',
              'application',
              'infrastructure',
              'shared',
              'blockchain',
            ]),
            ownModuleRule('interface', ['application', 'domain', 'shared']),
            {
              from: 'module-root',
              allow: [
                { type: 'domain', module: '${from.module}' },
                { type: 'application', module: '${from.module}' },
                { type: 'infrastructure', module: '${from.module}' },
                { type: 'interface', module: '${from.module}' },
                { type: 'shared' },
                { type: 'blockchain' },
              ],
            },
            {
              from: ['bootstrap', 'workers'],
              allow: [{ type: 'shared' }, { type: 'blockchain' }, { type: 'module-root' }],
            },
            { from: 'shared', allow: [{ type: 'shared' }] },
            { from: 'blockchain', allow: [{ type: 'blockchain' }, { type: 'shared' }] },
          ],
        },
      ],
      'boundaries/no-private': ['error'],
      // Domain may only reach into shared/errors (the documented pure-TS
      // error base). Any other shared import — e.g. shared/database — is a
      // domain-to-infrastructure leak and must fail lint.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/*', '!**/shared/errors', '!**/shared/errors/*'],
              message:
                'Domain may only import from shared/errors (the documented error base); other shared code is infrastructure.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/*', '!**/shared/errors', '!**/shared/errors/*'],
              message:
                'Domain may only import from shared/errors (the documented error base); other shared code is infrastructure.',
            },
          ],
        },
      ],
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
  {
    // Standalone CLI tools (scripts/load-test.ts, ...), not application
    // code reachable from src/ — console output is the actual point.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Plain Node.js ESM scripts (*.mjs) — no TypeScript, needs Node globals.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  prettier,
);
