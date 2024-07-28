// @ts-check

import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from "globals";
import "eslint-plugin-only-warn";

export default ts.config(
    {
        languageOptions: {
            globals: {
                ...globals.node
            }
        }
    },
    js.configs.recommended,
    ...ts.configs.recommended,
    {
        "rules": {
            "no-unused-vars": "off",
            // FIXME: Update to "checkLoops": "allExceptWhileTrue" when upgrading to ESLint 9
            "no-constant-condition": ["warn", { "checkLoops": false }],
            "@typescript-eslint/no-unused-vars": "off",
        }
    }
);
