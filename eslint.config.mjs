import js from '@eslint/js';
import globals from 'globals';

const commonRules = {
  ...js.configs.recommended.rules,
  'no-console': 'off',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-global-assign': 'off',
  'preserve-caught-error': 'off',
  'no-useless-assignment': 'off',
  'no-useless-escape': 'off',
  'no-unused-vars': 'off'
};

export default [
  {
    ignores: [
      'lib/**',
      'backup/**',
      'data/**',
      'node_modules/**',
      '客堂住宿系统.app/**'
    ]
  },
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2021,
        Chart: 'readonly',
        SQL: 'readonly'
      }
    },
    rules: {
      ...commonRules,
      // 多文件原生脚本通过全局作用域按加载顺序共享函数。| Native scripts share globals by load order.
      'no-undef': 'off',
      'no-inner-declarations': 'off',
      'no-redeclare': 'off'
    }
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.webworker,
        ...globals.es2021,
        atob: 'readonly',
        btoa: 'readonly',
        console: 'readonly',
        crypto: 'readonly',
        Response: 'readonly',
        TextEncoder: 'readonly'
      }
    },
    rules: commonRules
  }
];
