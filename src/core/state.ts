import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppState {
  lastModel?: string;
  teamModeActive?: boolean;
  planExecuteMode?: boolean;
  plannerModelId?: string;
  executorModelId?: string;
  thinkingMode?: boolean;
}

export class StateManager {
  private statePath: string;
  private state: AppState = {};

  constructor() {
    this.statePath = path.join(os.homedir(), ".yeti-code", "state.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.statePath)) {
        const data = fs.readFileSync(this.statePath, "utf-8");
        this.state = JSON.parse(data);
      }
    } catch (err) {
      // Fail silently for state
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err) {
      // Fail silently
    }
  }

  getLastModel(): string | undefined {
    return this.state.lastModel;
  }

  setLastModel(model: string): void {
    this.state.lastModel = model;
    this.save();
  }

  getTeamModeActive(): boolean | undefined {
    return this.state.teamModeActive;
  }

  setTeamModeActive(active: boolean): void {
    this.state.teamModeActive = active;
    this.save();
  }

  getPlanExecuteMode(): boolean | undefined {
    return this.state.planExecuteMode;
  }

  getPlannerModelId(): string | undefined {
    return this.state.plannerModelId;
  }

  getExecutorModelId(): string | undefined {
    return this.state.executorModelId;
  }

  setPlanExecuteMode(active: boolean, planner?: string, executor?: string): void {
    this.state.planExecuteMode = active;
    if (planner) this.state.plannerModelId = planner;
    if (executor) this.state.executorModelId = executor;
    this.save();
  }

  getThinkingMode(): boolean {
    return this.state.thinkingMode ?? false;
  }

  setThinkingMode(active: boolean): void {
    this.state.thinkingMode = active;
    this.save();
  }
}

export const stateManager = new StateManager();
