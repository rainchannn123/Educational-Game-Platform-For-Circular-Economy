import tseslint from "@typescript-eslint/eslint-plugin";
import parser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser, parserOptions: { projectService: true } },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-namespace": "warn"
    }
  },
  prettier
];
