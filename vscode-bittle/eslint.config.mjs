// @ts-check

import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import 'eslint-plugin-only-warn';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
    {
        ignores: [
            'out/*',
        ],
    },
    {
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    js.configs.recommended,
    ts.configs.strict,
    ts.configs.stylistic,
    stylistic.configs.customize({
        indent: 4,
        semi: true,
        quotes: 'single',
        braceStyle: '1tbs',
        commaDangle: 'always-multiline',
        blockSpacing: true,
        quoteProps: 'consistent',
    }),
    {
        rules: {
            'no-unused-vars': 'off',
            'no-constant-condition': ['warn', { checkLoops: 'allExceptWhileTrue' }],
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/consistent-type-definitions': 'off',
            '@typescript-eslint/no-inferrable-types': ['warn', { ignoreParameters: true, ignoreProperties: true }],
            '@typescript-eslint/consistent-generic-constructors': 'off',
            '@typescript-eslint/consistent-type-assertions': ['warn', { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' }],
            // Consider enabling this rule in the future
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@stylistic/spaced-comment': 'off',
            '@stylistic/arrow-parens': 'off',
            '@stylistic/no-mixed-operators': 'off',
            '@stylistic/operator-linebreak': ['warn', 'before', { 'overrides': { '=': 'after' } }],
        },
    },
);
