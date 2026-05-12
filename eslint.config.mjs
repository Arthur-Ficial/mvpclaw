// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import jsdoc from 'eslint-plugin-jsdoc';
import tsdoc from 'eslint-plugin-tsdoc';
import globals from 'globals';

/**
 * MVPClaw lint config — flat config.
 *
 * Three big choices encoded here:
 *
 *   1. `no-redeclare` is disabled. The Zod idiom
 *      `export const X = z.object(...); export type X = z.infer<typeof X>;`
 *      is the project's standard pattern; the rule does not recognise
 *      type-and-value duals in this case.
 *
 *   2. JSDoc / TSDoc are REQUIRED on every exported symbol from `src/`.
 *      This is the source-as-documentation policy from CLAUDE.md — there
 *      is no separate docs portal, the codebase documents itself, and
 *      `pnpm check` rejects undocumented public exports.
 *
 *   3. Test files are exempt from the docstring rule (they document
 *      themselves through their `describe` / `it` blocks).
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'data/**', 'workspace/**'],
  },
  js.configs.recommended,
  // Source files — strict, JSDoc required.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      jsdoc,
      tsdoc,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      'no-console': ['error', { allow: ['error'] }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],

      // Source-as-documentation enforcement.
      'tsdoc/syntax': 'error',
      // Require JSDoc on every public function / class / interface / enum.
      // Type aliases (e.g. Zod `z.infer<typeof X>` duals) and exported consts
      // don't need their own block — the surrounding context covers them.
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: ['TSInterfaceDeclaration', 'TSEnumDeclaration'],
          checkConstructors: false,
        },
      ],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/no-undefined-types': 'off', // tsc covers this; jsdoc is noisy
      'jsdoc/check-tag-names': ['error', { definedTags: ['public', 'internal', 'remarks'] }],
    },
  },
  // Test files — lighter rules, no docstring requirement.
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
    },
  },
];
