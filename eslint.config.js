// ESLint flat config, with the rules of the former .eslintrc.js
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier/flat");
const globals = require("globals");

module.exports = tseslint.config(
    { ignores: ["dist/", "node_modules/"] },
    js.configs.recommended,
    tseslint.configs.recommended,
    prettier,
    {
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": [1, { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-empty-function": [0],
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
        },
    },
);
