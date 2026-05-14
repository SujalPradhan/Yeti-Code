/**
 * Model Registry — manages available model configurations and hot-swapping.
 *
 * Each ModelConfig represents a specific model + provider combination.
 * The registry allows listing, selecting, and switching models mid-session
 * in a style similar to Claude Code / Copilot.
 */

import type { LLMProvider } from "./types";

export interface ModelConfig {
  /** Display ID used in /model commands (e.g., "gemini-2.5-flash", "gemma3:4b") */
  id: string;
  /** Human-readable label for display */
  label: string;
  /** Provider backend: "gemini" or "ollama" */
  providerType: "gemini" | "ollama";
  /** The actual model name to send to the API */
  modelName: string;
  /** Whether this model is currently reachable / usable */
  available: boolean;
  /** Whether this model supports tool/function calling (default: true). Ollama models vary. */
  supportsTools: boolean;
}

export class ModelRegistry {
  private models: Map<string, ModelConfig> = new Map();
  private providers: Map<string, LLMProvider> = new Map();
  private activeId: string = "";

  /** Register a provider backend by name. */
  registerProvider(name: string, provider: LLMProvider): void {
    this.providers.set(name, provider);
  }

  /** Add a model configuration. */
  addModel(config: ModelConfig): void {
    this.models.set(config.id, config);
    if (!this.activeId) {
      this.activeId = config.id;
    }
  }

  /** Get the currently active model config. */
  getActive(): ModelConfig {
    const model = this.models.get(this.activeId);
    if (!model) {
      throw new Error("No active model is set.");
    }
    return model;
  }

  /** Get the LLMProvider for the currently active model. */
  getActiveProvider(): LLMProvider {
    const config = this.getActive();
    const provider = this.providers.get(config.providerType);
    if (!provider) {
      throw new Error(`Provider "${config.providerType}" is not registered.`);
    }
    return provider;
  }

  /** Get the model name string for the currently active model. */
  getActiveModelName(): string {
    return this.getActive().modelName;
  }

  /** Switch to a different model by ID. Returns true if successful. */
  setActive(id: string): boolean {
    const config = this.models.get(id);
    if (!config) return false;
    this.activeId = id;
    return true;
  }

  /** List all registered models. */
  list(): ModelConfig[] {
    return Array.from(this.models.values());
  }

  /** Mark a model as available or unavailable. */
  setAvailability(id: string, available: boolean): void {
    const config = this.models.get(id);
    if (config) {
      config.available = available;
    }
  }

  /** Get the active model ID. */
  getActiveId(): string {
    return this.activeId;
  }

  /** Get the provider instance by provider type name. */
  getProviderFor(providerType: string): import("./types").LLMProvider | undefined {
    return this.providers.get(providerType);
  }

  /**
   * Family-preference order for picking an agentic worker. Earlier wins.
   * gemma4 sits at the top because it's our verified default; the rest
   * are documented tool-callers we trust to behave in the agent loop.
   */
  private static readonly WORKER_FAMILIES = [
    "gemma4",
    "qwen3",
    "qwen2.5",
    "llama3.1",
    "llama3",
    "mistral",
    "command-r",
  ];

  /**
   * List all locally-available, tool-capable Ollama models whose id starts
   * with a known agentic family. Used by team mode to enumerate workers.
   */
  listToolWorkers(): ModelConfig[] {
    return this.list().filter(
      (m) =>
        m.available &&
        m.providerType === "ollama" &&
        m.supportsTools &&
        ModelRegistry.WORKER_FAMILIES.some((f) =>
          m.id.toLowerCase().startsWith(f),
        ),
    );
  }

  /**
   * Pick the best worker for team mode. Two-level sort:
   *   1. earlier in WORKER_FAMILIES wins (gemma4 before qwen3, …)
   *   2. within a family, largest by extracted `:Nb` size wins
   * Returns undefined when no compatible worker is registered.
   */
  pickBestWorker(): ModelConfig | undefined {
    const workers = this.listToolWorkers();
    if (workers.length === 0) return undefined;
    const familyRank = (id: string): number => {
      const lower = id.toLowerCase();
      const idx = ModelRegistry.WORKER_FAMILIES.findIndex((f) =>
        lower.startsWith(f),
      );
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    };
    const sizeOf = (id: string): number => {
      const m = id.match(/:(\d+(?:\.\d+)?)b/i);
      return m ? parseFloat(m[1]) : 0;
    };
    return [...workers].sort((a, b) => {
      const fa = familyRank(a.id);
      const fb = familyRank(b.id);
      if (fa !== fb) return fa - fb;
      return sizeOf(b.id) - sizeOf(a.id);
    })[0];
  }
}
