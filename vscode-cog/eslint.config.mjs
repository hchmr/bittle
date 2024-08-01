// @ts-check

import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import 'eslint-plugin-only-warn';
import stylistic from '@stylistic/eslint-plugin';

export default ts.config(
    {
        ignores: [
            'dist/*',
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
    ...ts.configs.recommended,
    //@ts-expect-error "Argument of type 'Config<RulesRecord>' is not assignable to parameter of type 'ConfigWithExtends'."
    stylistic.configs.customize({
        indent: 4,
        flat: true,
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
            // FIXME: Update to "checkLoops": "allExceptWhileTrue" when upgrading to ESLint 9
            'no-constant-condition': ['warn', { checkLoops: false }],
            '@typescript-eslint/no-unused-vars': 'off',

            '@stylistic/spaced-comment': 'off',
            '@stylistic/arrow-parens': 'off',
        },
    },
);
