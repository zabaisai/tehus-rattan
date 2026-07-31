// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `src/generated` es el cliente de Prisma: codigo generado. Analizarlo
    // solo produce ruido —sus errores no se pueden arreglar en el origen— y,
    // peor, `lint --fix` lo REESCRIBE entero, ensuciando cualquier commit con
    // miles de lineas ajenas al cambio.
    ignores: ['eslint.config.mjs', 'src/generated/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/require-await': 'off',
      // El guion bajo delante ya es la forma en que este codigo dice "esto
      // sobra a proposito": un parametro que exige el decorador, o el campo
      // que se descarta al desestructurar para construir un cuerpo sin el.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
  {
    // En las pruebas, `expect(mock.metodo)` es el modo normal de aserción de
    // Jest y no pierde ningun `this`: el doble ES la funcion. La regla existe
    // para codigo real, donde separar un metodo de su objeto si rompe; aqui
    // solo obliga a envolver veinte aserciones en ruido que no aporta nada.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);