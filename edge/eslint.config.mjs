import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "telnyx-env.d.ts"],
  },
  ...tseslint.configs.recommended,
);
