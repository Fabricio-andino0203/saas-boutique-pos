import { defineConfig, devices } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  testIgnore: ["**/blueprints/**"],
  fullyParallel: true,
  // Las acciones del servidor tardan más cuando varios navegadores comparten servidor y base de datos.
  expect: { timeout: 15_000 },
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !isCI,
    timeout: 240_000,
    env: { NEXT_PUBLIC_COMPONENT_GALLERY: "enabled" },
  },
});
