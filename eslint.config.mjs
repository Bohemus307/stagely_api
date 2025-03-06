import config from "eslint-config-standard";

/** @type {import('eslint').Linter.Config} */
export default [
  ...[].concat(config),
  {
    env: {
      node: true,
      es2022: true,
    },
    extends: [
      "standard",
      "eslint:recommended",
      "plugin:node/recommended",
      "plugin:security/recommended",
      "plugin:prettier/recommended",
    ],
    plugins: ["node", "security", "prettier"],
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Error prevention
      "no-console": process.env.NODE_ENV === "production" ? "warn" : "off",
      "no-debugger": process.env.NODE_ENV === "production" ? "error" : "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-return-await": "error",
      "node/no-unsupported-features/es-syntax": [
        "error",
        { ignores: ["modules"] },
      ],

      // Best practices for Node.js
      "node/no-missing-import": "off", // Compatible with TypeScript paths
      "node/no-unpublished-import": "off", // Allow dev dependencies
      "security/detect-object-injection": "warn",
      "security/detect-non-literal-fs-filename": "warn",

      // Code style for consistency
      "array-bracket-spacing": ["error", "never"],
      "arrow-parens": ["error", "always"],
      "block-spacing": ["error", "always"],
      "comma-dangle": ["error", "only-multiline"],
      "eol-last": ["error", "always"],
      "max-len": ["warn", { code: 100, ignoreUrls: true, ignoreStrings: true }],
      "no-multiple-empty-lines": ["error", { max: 1, maxEOF: 1 }],
      "object-curly-spacing": ["error", "always"],
      quotes: ["error", "single", { avoidEscape: true }],
      semi: ["error", "always"],

      // Async handling
      "require-await": "error",
      "no-promise-executor-return": "error",
      "prefer-promise-reject-errors": "error",

      // Make prettier work with ESLint
      "prettier/prettier": [
        "error",
        {
          singleQuote: true,
          trailingComma: "es5",
          printWidth: 100,
          semi: true,
          tabWidth: 2,
        },
      ],
    },
    overrides: [
      // TypeScript specific settings
      {
        files: ["*.ts", "*.js"],
        extends: [
          "plugin:@typescript-eslint/recommended",
          "plugin:@typescript-eslint/recommended-requiring-type-checking",
        ],
        plugins: ["@typescript-eslint"],
        parser: "@typescript-eslint/parser",
        parserOptions: {
          project: "./tsconfig.json",
        },
        rules: {
          "@typescript-eslint/explicit-function-return-type": "warn",
          "@typescript-eslint/no-explicit-any": "warn",
          "@typescript-eslint/no-floating-promises": "error",
          "@typescript-eslint/no-misused-promises": "error",
          "@typescript-eslint/no-unused-vars": [
            "error",
            { argsIgnorePattern: "^_" },
          ],
          "node/no-missing-import": "off",
        },
      },
    ],
  },
];
