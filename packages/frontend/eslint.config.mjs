import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";
import jsxA11y from "eslint-plugin-jsx-a11y";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Apply the jsx-a11y recommended rules. The `next` configs already register
  // the `jsx-a11y` plugin, so we only take its rules (not its `plugins` key)
  // to avoid an ESLint "cannot redefine plugin" flat-config error.
  {
    rules: jsxA11y.flatConfigs.recommended.rules,
    languageOptions: jsxA11y.flatConfigs.recommended.languageOptions,
  },
];

export default eslintConfig;
