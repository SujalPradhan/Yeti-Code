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
    return this.models.get(this.activeId)!;
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
}
