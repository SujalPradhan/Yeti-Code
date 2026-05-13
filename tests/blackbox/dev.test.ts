import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  findFilesTool,
  npmTool,
  gitTool,
  runScriptTool,
} from "../../src/features/tools/builtins/dev";
import {
  makeWorkspace,
  approvingCtx,
  rejectingCtx,
  writeFixture,
  withSilencedStdout,
  commandExists,
} from "./_helpers";
import { execSync } from "child_process";

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => cleanup());

describe("find_files", () => {
  it("finds files by glob across nested dirs", async () => {
    writeFixture("src/a.ts", "");
    writeFixture("src/nested/b.ts", "");
    writeFixture("src/c.js", "");
    const out = await findFilesTool.execute({ pattern: "**/*.ts" }, approvingCtx());
    const lines = out.split("\n").sort();
    expect(lines).toEqual(["src/a.ts", "src/nested/b.ts"]);
  });

  it("matches a simple basename glob", async () => {
    writeFixture("foo.test.ts", "");
    writeFixture("foo.ts", "");
    const out = await findFilesTool.execute({ pattern: "*.test.ts" }, approvingCtx());
    expect(out).toContain("foo.test.ts");
    expect(out).not.toContain("foo.ts\n");
  });

  it("returns a clear miss message", async () => {
    writeFixture("a.txt", "");
    const out = await findFilesTool.execute({ pattern: "**/*.py" }, approvingCtx());
    expect(out).toMatch(/No files match/);
  });

  it("skips node_modules", async () => {
    writeFixture("node_modules/lib/x.ts", "");
    writeFixture("src/x.ts", "");
    const out = await findFilesTool.execute({ pattern: "**/*.ts" }, approvingCtx());
    expect(out).toBe("src/x.ts");
  });
});

describe("npm — allowlist", () => {
  it("rejects subcommands not on the allowlist", async () => {
    const out = await npmTool.execute({ subcommand: "publish" }, approvingCtx());
    expect(out).toMatch(/not on the allowlist/);
  });

  it("requires confirmation for destructive subcommands and respects rejection", async () => {
    const out = await npmTool.execute({ subcommand: "install", args: ["lodash"] }, rejectingCtx());
    expect(out).toMatch(/cancelled/i);
  });

  it("runs a read-only allowlisted subcommand", async () => {
    if (!commandExists("npm")) return;
    writeFixture(
      "package.json",
      JSON.stringify({ name: "fixture", version: "1.0.0" }, null, 2),
    );
    const out = await withSilencedStdout(() =>
      npmTool.execute({ subcommand: "ls", args: ["--depth=0"] }, approvingCtx()),
    );
    // `npm ls` exits 0 with output OR exits 1 with "missing dependencies" — both
    // are surfaced as strings. We just want to see npm produced *something*.
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/fixture|empty|extraneous|missing|Exit/i);
  });
});

describe("git — read-only allowlist", () => {
  it("rejects write subcommands", async () => {
    const out = await gitTool.execute({ subcommand: "commit", args: ["-m", "x"] }, approvingCtx());
    expect(out).toMatch(/not on the read-only allowlist/);
  });

  it("rejects push", async () => {
    const out = await gitTool.execute({ subcommand: "push" }, approvingCtx());
    expect(out).toMatch(/not on the read-only allowlist/);
  });

  it("runs git status in an initialized repo", async () => {
    if (!commandExists("git")) return;
    execSync("git init -q && git config user.email t@t && git config user.name t", { stdio: "ignore" });
    writeFixture("a.txt", "hello");
    const out = await withSilencedStdout(() =>
      gitTool.execute({ subcommand: "status", args: ["--short"] }, approvingCtx()),
    );
    expect(out).toMatch(/\?\? a\.txt/);
  });
});

describe("run_script", () => {
  it("executes a .sh script and captures output", async () => {
    if (!commandExists("bash")) return;
    writeFixture("hi.sh", "#!/bin/bash\necho hello-from-bash\n");
    const out = await withSilencedStdout(() =>
      runScriptTool.execute({ path: "hi.sh" }, approvingCtx()),
    );
    expect(out).toMatch(/hello-from-bash/);
  });

  it("executes a .js script with node", async () => {
    if (!commandExists("node")) return;
    writeFixture("hi.js", "console.log('hello-from-node');");
    const out = await withSilencedStdout(() =>
      runScriptTool.execute({ path: "hi.js" }, approvingCtx()),
    );
    expect(out).toMatch(/hello-from-node/);
  });

  it("rejects unknown extensions", async () => {
    writeFixture("weird.xyz", "noop");
    const out = await runScriptTool.execute({ path: "weird.xyz" }, approvingCtx());
    expect(out).toMatch(/no interpreter mapped/);
  });

  it("respects user cancellation", async () => {
    writeFixture("hi.sh", "echo nope");
    const out = await runScriptTool.execute({ path: "hi.sh" }, rejectingCtx());
    expect(out).toMatch(/cancelled/i);
  });

  it("blocks paths outside the workspace", async () => {
    const out = await runScriptTool.execute({ path: "../../etc/passwd" }, approvingCtx());
    expect(out).toMatch(/outside workspace/);
  });

  it("passes args to the script", async () => {
    if (!commandExists("bash")) return;
    writeFixture("args.sh", '#!/bin/bash\necho "got:$1:$2"\n');
    const out = await withSilencedStdout(() =>
      runScriptTool.execute({ path: "args.sh", args: ["alpha", "beta"] }, approvingCtx()),
    );
    expect(out).toMatch(/got:alpha:beta/);
  });
});
