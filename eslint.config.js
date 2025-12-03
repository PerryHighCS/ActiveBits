export default [
  // Minimal root config to satisfy VS Code ESLint for non-client folders.
  // Client-specific linting remains in client/eslint.config.js.
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.vite/**",
      "**/.next/**",
      "**/.cache/**",
    ],
  },
];
