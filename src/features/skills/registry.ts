import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import type { Skill } from "./types";

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private activeSkillName: string = "default";

  constructor() {
    // Default fallback skill
    this.register({
      name: "default",
      description: "Default YetiMind assistant.",
      systemPrompt: "You are YetiMind, a helpful and concise terminal AI assistant. Answer clearly and directly. Use markdown formatting when helpful.",
      tools: ["read_file", "write_file", "shell"]
    });
  }

  register(skill: Skill): void {
    this.skills.set(skill.name.toLowerCase(), skill);
  }

  async loadFromDirectory(dirPath: string): Promise<void> {
    try {
      // Resolve tilde
      const resolvedPath = dirPath.startsWith("~") 
        ? path.join(os.homedir(), dirPath.slice(1)) 
        : dirPath;

      await fs.mkdir(resolvedPath, { recursive: true });
      const files = await fs.readdir(resolvedPath);
      
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(path.join(resolvedPath, file), "utf-8");
          const skill = JSON.parse(content) as Skill;
          this.register(skill);
        }
      }
    } catch (error) {
      console.error(`Warning: Could not load skills from ${dirPath}:`, error);
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name.toLowerCase());
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  setActive(name: string): boolean {
    if (this.skills.has(name.toLowerCase())) {
      this.activeSkillName = name.toLowerCase();
      return true;
    }
    return false;
  }

  getActive(): Skill {
    return this.skills.get(this.activeSkillName)!;
  }
}
