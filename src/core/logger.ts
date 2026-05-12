import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

export class SessionLogger {
  private logPath: string;

  constructor() {
    this.logPath = path.join(os.homedir(), ".yetimind", "logs", `session_${Date.now()}.log`);
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });
    await this.log("Session started");
  }

  async log(message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}\n`;
    try {
      await fs.appendFile(this.logPath, entry);
    } catch (err) {
      // Fail silently for logging
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}
