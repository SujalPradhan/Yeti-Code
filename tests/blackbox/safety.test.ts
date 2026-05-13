import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { grepTool, sedTool, headFileTool, countLinesTool } from "../../src/features/tools/builtins/text";
import { findFilesTool, runScriptTool, npmTool, gitTool } from "../../src/features/tools/builtins/dev";
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listDirTool,
} from "../../src/features/tools/builtins/fs";
import { makeWorkspace, approvingCtx, writeFixture } from "./_helpers";

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => cleanup());

describe("workspace sandbox — every file-touching tool must reject traversal", () => {
  const escapes = ["../../../etc/passwd", "/etc/passwd", "../outside.txt"];

  for (const bad of escapes) {
    it(`read_file blocks "${bad}"`, async () => {
      const out = await readFileTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`write_file blocks "${bad}"`, async () => {
      const out = await writeFileTool.execute({ path: bad, content: "x" }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`edit_file blocks "${bad}"`, async () => {
      const out = await editFileTool.execute(
        { path: bad, old_str: "a", content: "b" },
        approvingCtx(),
      );
      expect(out).toMatch(/outside workspace/);
    });
    it(`delete_file blocks "${bad}"`, async () => {
      const out = await deleteFileTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`list_dir blocks "${bad}"`, async () => {
      const out = await listDirTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`grep blocks "${bad}"`, async () => {
      const out = await grepTool.execute({ pattern: ".", path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`sed blocks "${bad}"`, async () => {
      const out = await sedTool.execute(
        { path: bad, pattern: "x", replacement: "y" },
        approvingCtx(),
      );
      expect(out).toMatch(/outside workspace/);
    });
    it(`head_file blocks "${bad}"`, async () => {
      const out = await headFileTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`count_lines blocks "${bad}"`, async () => {
      const out = await countLinesTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
    it(`run_script blocks "${bad}"`, async () => {
      const out = await runScriptTool.execute({ path: bad }, approvingCtx());
      expect(out).toMatch(/outside workspace/);
    });
  }
});

describe("command allowlists", () => {
  it("npm rejects every non-allowlisted subcommand", async () => {
    const banned = ["publish", "unpublish", "deprecate", "adduser", "logout", "token", "owner"];
    for (const sub of banned) {
      const out = await npmTool.execute({ subcommand: sub }, approvingCtx());
      expect(out, `npm ${sub} must be rejected`).toMatch(/not on the allowlist/);
    }
  });

  it("git rejects every write subcommand", async () => {
    const banned = ["commit", "push", "fetch", "pull", "merge", "rebase", "checkout", "reset", "clean", "rm", "mv"];
    for (const sub of banned) {
      const out = await gitTool.execute({ subcommand: sub }, approvingCtx());
      expect(out, `git ${sub} must be rejected`).toMatch(/not on the read-only allowlist/);
    }
  });

  it("read-only git subcommands pass the allowlist gate", async () => {
    // We don't run them — we just confirm the allowlist isn't the rejection reason.
    // If git isn't installed the spawn will fail, but the message will not match /not on the read-only allowlist/.
    const allowed = ["status", "log", "diff", "show", "blame", "ls-files"];
    for (const sub of allowed) {
      const out = await gitTool.execute({ subcommand: sub, cwd: "." }, approvingCtx());
      expect(out, `git ${sub} should not be rejected by allowlist`).not.toMatch(
        /not on the read-only allowlist/,
      );
    }
  });
});

describe("regex safety", () => {
  it("grep surfaces invalid regex without crashing", async () => {
    writeFixture("a.txt", "anything");
    const out = await grepTool.execute({ pattern: "[unclosed", path: "a.txt" }, approvingCtx());
    expect(out).toMatch(/invalid regex/);
  });

  it("sed surfaces invalid regex without writing", async () => {
    writeFixture("a.txt", "anything");
    const out = await sedTool.execute(
      { path: "a.txt", pattern: "[unclosed", replacement: "y" },
      approvingCtx(),
    );
    expect(out).toMatch(/invalid regex/);
  });
});

describe("find_files traversal safety", () => {
  it("rejects an out-of-workspace dir", async () => {
    const out = await findFilesTool.execute(
      { pattern: "**/*", dir: "../../../etc" },
      approvingCtx(),
    );
    expect(out).toMatch(/outside workspace/);
  });
});
