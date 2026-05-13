import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/blackbox/**/*.test.ts"],
    // The tools touch process.cwd() (via resolveWorkspacePath) and chdir into
    // temp workspaces per test. Run tests serially so chdir doesn't race.
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    reporters: ["default"],
  },
});
