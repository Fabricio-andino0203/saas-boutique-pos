import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("ci.yml", () => {
  it.each([
    "runs-on: ubuntu-24.04",
    "actions/checkout@v7",
    "actions/setup-node@v7",
    "pnpm/action-setup@v6",
    "image: postgres:16-alpine",
    "--health-cmd",
    "DATABASE_URL_TEST:",
    "AUTH_SECRET:",
    "APP_URL:",
    "pnpm exec playwright install --with-deps chromium",
    "if: github.ref == 'refs/heads/main'",
    "docker build --build-arg APP_VERSION=${{ github.sha }} --tag boutique-pos:ci .",
  ])("contains %s", (needle) => {
    expect(workflow).toContain(needle);
  });

  it.each([
    "pnpm install --frozen-lockfile",
    "pnpm audit --prod --audit-level=high",
    "pnpm db:generate",
    "pnpm db:seed",
    "pnpm lint",
    "pnpm exec eslint --max-warnings 0",
    "pnpm exec next typegen",
    "pnpm typecheck",
    "pnpm format:check",
    "pnpm test",
    "pnpm test:coverage",
    "pnpm build",
    "pnpm test:e2e",
  ])("runs the full command line: %s", (command) => {
    expect(workflow).toMatch(new RegExp(`^\\s*- run: ${escapeRegExp(command)}$`, "m"));
  });
});
