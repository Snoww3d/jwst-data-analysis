import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import eslintReact from '@eslint-react/eslint-plugin';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';

export default [
  // Ignore patterns
  {
    ignores: ['dist/**', 'build/**', 'node_modules/**', '*.config.js', '*.config.ts'],
  },

  // Base JavaScript/TypeScript config
  js.configs.recommended,

  // TypeScript files
  {
    files: ['src/**/*.{ts,tsx}'],
    ...eslintReact.configs['recommended-typescript'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLCanvasElement: 'readonly',
        CanvasRenderingContext2D: 'readonly',
        ImageData: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
        EventTarget: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        RequestInit: 'readonly',
        Response: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        SVGSVGElement: 'readonly',
        DOMRect: 'readonly',
      },
    },
    plugins: {
      ...eslintReact.configs['recommended-typescript'].plugins,
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
    },
    rules: {
      // @eslint-react rules from recommended-typescript preset
      ...eslintReact.configs['recommended-typescript'].rules,

      // TypeScript rules
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React Hooks rules (full recommended preset from react-hooks v7.1)
      ...reactHooksPlugin.configs['recommended-latest'].rules,

      // React Refresh (Vite HMR)
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },

  // Type definition files - allow 'any' for external API data shapes
  {
    files: ['src/types/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Remaining config for all TS/TSX files
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // General rules
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always', { null: 'ignore' }],
    },
  },
];
