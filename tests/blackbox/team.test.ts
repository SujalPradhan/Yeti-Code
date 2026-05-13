import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ModelRegistry } from "../../src/infrastructure/llm/registry";
import { TeamOrchestrator } from "../../src/domain/team/orchestrator";
import { delegateTasksTool } from "../../src/features/tools/builtins/delegateTasks";
import {
  makeWorkspace,
  approvingCtx,
  fakeLogger,
} from "./_helpers";
import type { LLMProvider, StreamChatOptions } from "../../src/infrastructure/llm/types";
import type { StreamResult } from "../../src/domain/types";

let cleanup: () => void;

beforeEach(() => {
  ({ cleanup } = makeWorkspace());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ── Stub providers ────────────────────────────────────────────────────────
class CannedOllamaProvider implements LLMProvider {
  public calls: StreamChatOptions[] = [];
  constructor(private readonly textFor: (model: string, prompt: string) => string) {}
  async streamChat(opts: StreamChatOptions): Promise<StreamResult> {
    this.calls.push(opts);
    const prompt = (opts.contents[0]?.parts?.[0] as { text?: string } | undefined)?.text ?? "";
    const text = this.textFor(opts.model, prompt);
    for (const ch of text) opts.writeToken(ch);
    return { text, functionCalls: [], promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
}

function registryWithModels(models: Array<{ id: string; modelName?: string; supportsTools?: boolean; providerType?: "ollama" | "gemini" }>): {
  registry: ModelRegistry;
  provider: CannedOllamaProvider;
} {
  const registry = new ModelRegistry();
  const provider = new CannedOllamaProvider((model, prompt) => `done:${model}:${prompt.slice(0, 20)}`);
  registry.registerProvider("ollama", provider);
  for (const m of models) {
    registry.addModel({
      id: m.id,
      label: m.id,
      providerType: m.providerType ?? "ollama",
      modelName: m.modelName ?? m.id,
      available: true,
      supportsTools: m.supportsTools ?? true,
    });
  }
  return { registry, provider };
}

// ── ModelRegistry Qwen helpers ─────────────────────────────────────────────
describe("ModelRegistry — Qwen selection", () => {
  it("listQwen filters to Ollama-hosted Qwen variants", () => {
    const { registry } = registryWithModels([
      { id: "qwen3:4b" },
      { id: "qwen2.5:7b" },
      { id: "gemma3:4b" },
      { id: "mistral:7b" },
    ]);
    const ids = registry.listQwen().map((m) => m.id).sort();
    expect(ids).toEqual(["qwen2.5:7b", "qwen3:4b"]);
  });

  it("pickBestQwen prefers tool-capable variants", () => {
    const { registry } = registryWithModels([
      { id: "qwen3:4b", supportsTools: true },
      { id: "qwen3:32b", supportsTools: false },
    ]);
    expect(registry.pickBestQwen()?.id).toBe("qwen3:4b");
  });

  it("pickBestQwen prefers larger when tool support is equal", () => {
    const { registry } = registryWithModels([
      { id: "qwen3:4b" },
      { id: "qwen3:14b" },
      { id: "qwen3:8b" },
    ]);
    expect(registry.pickBestQwen()?.id).toBe("qwen3:14b");
  });

  it("pickBestQwen returns undefined when no Qwen is registered", () => {
    const { registry } = registryWithModels([
      { id: "gemma3:4b" },
      { id: "mistral:7b" },
    ]);
    expect(registry.pickBestQwen()).toBeUndefined();
  });

  it("only returns available models", () => {
    const { registry } = registryWithModels([{ id: "qwen3:4b" }]);
    registry.setAvailability("qwen3:4b", false);
    expect(registry.listQwen()).toEqual([]);
    expect(registry.pickBestQwen()).toBeUndefined();
  });
});

// ── TeamOrchestrator ───────────────────────────────────────────────────────
describe("TeamOrchestrator", () => {
  it("pickWorkerModelId returns the best Qwen", () => {
    const { registry } = registryWithModels([
      { id: "qwen3:14b" },
      { id: "qwen3:4b" },
      { id: "gemma3:4b" },
    ]);
    const orch = new TeamOrchestrator(registry);
    expect(orch.pickWorkerModelId()).toBe("qwen3:14b");
  });

  it("pickWorkerModelId throws with a useful hint when no Qwen is present", () => {
    const { registry } = registryWithModels([{ id: "gemma3:4b" }]);
    const orch = new TeamOrchestrator(registry);
    expect(() => orch.pickWorkerModelId()).toThrowError(/ollama pull qwen3/);
  });

  it("runParallel calls every sub-agent and returns aggregated results", async () => {
    const { registry, provider } = registryWithModels([{ id: "qwen3:4b" }]);
    const orch = new TeamOrchestrator(registry);
    const events: string[] = [];
    const results = await orch.runParallel(
      [
        { id: "t1", description: "d1", prompt: "p1", modelId: "qwen3:4b" },
        { id: "t2", description: "d2", prompt: "p2", modelId: "qwen3:4b" },
      ],
      {
        onTaskStart: (t) => events.push(`start:${t.id}`),
        onTaskComplete: (r) => events.push(`done:${r.taskId}`),
      },
    );
    expect(results.map((r) => r.taskId).sort()).toEqual(["t1", "t2"]);
    expect(results.every((r) => r.result.startsWith("done:qwen3:4b"))).toBe(true);
    expect(provider.calls.length).toBe(2);
    expect(events).toContain("start:t1");
    expect(events).toContain("done:t1");
  });

  it("formatResultsForLeader produces a synthesis-ready prompt", () => {
    const { registry } = registryWithModels([{ id: "qwen3:4b" }]);
    const orch = new TeamOrchestrator(registry);
    const out = orch.formatResultsForLeader(
      { reasoning: "r", tasks: [{ id: "t1", description: "do x", prompt: "p", modelId: "qwen3:4b" }] },
      [{ taskId: "t1", modelId: "qwen3:4b", result: "answer", durationMs: 12 }],
    );
    expect(out).toMatch(/## Task: do x/);
    expect(out).toMatch(/answer/);
    expect(out).toMatch(/synthesise/i);
  });
});

// ── delegate_tasks tool ────────────────────────────────────────────────────
describe("delegate_tasks tool", () => {
  function ctxWithOrchestrator(registry: ModelRegistry) {
    const ctx = approvingCtx() as ReturnType<typeof approvingCtx> & {
      teamOrchestrator: TeamOrchestrator;
    };
    ctx.teamOrchestrator = new TeamOrchestrator(registry);
    ctx.logger = fakeLogger();
    return ctx;
  }

  it("refuses when team mode isn't active (no orchestrator in context)", async () => {
    const out = await delegateTasksTool.execute(
      {
        reasoning: "x",
        tasks: [{ id: "t1", description: "d", prompt: "p", modelId: "qwen3:4b" }],
      },
      approvingCtx(),
    );
    expect(out).toMatch(/requires team mode/);
  });

  it("forces every task.modelId to the best Qwen, ignoring what the leader picked", async () => {
    const { registry, provider } = registryWithModels([
      { id: "qwen3:14b" },
      { id: "qwen3:4b" },
      { id: "gemma3:4b" },
    ]);
    const ctx = ctxWithOrchestrator(registry);
    const result = await delegateTasksTool.execute(
      {
        reasoning: "split work",
        tasks: [
          { id: "t1", description: "d1", prompt: "p1", modelId: "gemma3:4b" }, // leader's pick
          { id: "t2", description: "d2", prompt: "p2", modelId: "mistral:7b" }, // not even in registry
        ],
      },
      ctx,
    );
    expect(result).toMatch(/Task: d1/);
    // every provider call must be the chosen Qwen, regardless of leader hint
    expect(provider.calls.length).toBe(2);
    for (const call of provider.calls) {
      expect(call.model).toBe("qwen3:14b");
    }
  });

  it("returns a clear error when no Qwen is available", async () => {
    const { registry } = registryWithModels([{ id: "gemma3:4b" }]);
    const ctx = ctxWithOrchestrator(registry);
    const out = await delegateTasksTool.execute(
      {
        reasoning: "x",
        tasks: [{ id: "t1", description: "d", prompt: "p", modelId: "anything" }],
      },
      ctx,
    );
    expect(out).toMatch(/ollama pull qwen3/);
  });

  it("rejects malformed tasks", async () => {
    const { registry } = registryWithModels([{ id: "qwen3:4b" }]);
    const ctx = ctxWithOrchestrator(registry);
    const out = await delegateTasksTool.execute(
      { reasoning: "x", tasks: [{ id: "t1" } as unknown as Record<string, unknown>] },
      ctx,
    );
    expect(out).toMatch(/each task must include/);
  });

  it("accepts JSON-stringified tasks array", async () => {
    const { registry, provider } = registryWithModels([{ id: "qwen3:4b" }]);
    const ctx = ctxWithOrchestrator(registry);
    await delegateTasksTool.execute(
      {
        reasoning: "x",
        tasks: JSON.stringify([
          { id: "t1", description: "d", prompt: "p", modelId: "qwen3:4b" },
        ]),
      },
      ctx,
    );
    expect(provider.calls.length).toBe(1);
  });
});
