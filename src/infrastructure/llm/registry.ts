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
   * List all locally-available Qwen models, tool-capable first then by id
   * (which roughly orders by size since "qwen3:32b" > "qwen3:4b" lexically
   * only sometimes — caller should pick deliberately).
   */
  listQwen(): ModelConfig[] {
    return this.list().filter(
      (m) =>
        m.available &&
        m.providerType === "ollama" &&
        m.id.toLowerCase().startsWith("qwen"),
    );
  }

  /**
   * Pick the best Qwen for team work: prefers tool-capable variants and,
   * within those, the largest by extracted parameter count (e.g. qwen3:14b
   * over qwen3:4b). Returns undefined if no Qwen is registered.
   */
  pickBestQwen(): ModelConfig | undefined {
    const qwens = this.listQwen();
    if (qwens.length === 0) return undefined;
    const sizeOf = (id: string): number => {
      const m = id.match(/:(\d+(?:\.\d+)?)b/i);
      return m ? parseFloat(m[1]) : 0;
    };
    const sorted = [...qwens].sort((a, b) => {
      // tool support wins first
      if (a.supportsTools !== b.supportsTools) return a.supportsTools ? -1 : 1;
      return sizeOf(b.id) - sizeOf(a.id);
    });
    return sorted[0];
  }
}
