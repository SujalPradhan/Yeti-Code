import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AppState {
  lastModel?: string;
}

export class StateManager {
  private statePath: string;
  private state: AppState = {};

  constructor() {
    this.statePath = path.join(os.homedir(), ".yetimind", "state.json");
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
}

export const stateManager = new StateManager();
