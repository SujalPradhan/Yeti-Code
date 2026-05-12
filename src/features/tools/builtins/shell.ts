import { spawn } from "child_process";
import chalk from "chalk";
import type { Tool, ToolContext } from "../types";

const SHELL_TIMEOUT_MS = 30_000;

export const shellTool: Tool = {
  name: "shell",
  description: "Execute a shell command. Streams stdout live, captures stderr. 30 second timeout.",
  schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute." },
      cwd: { type: "string", description: "Optional working directory." },
    },
    required: ["command"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = args["command"] as string;
    const cwdArg = args["cwd"] as string | undefined;
    if (!command) return 'Error: "command" parameter is required.';

    await ctx.logger.log(`shell: ${command}`);

    return new Promise<string>((resolve) => {
      // Print separator so streaming output is distinct
      process.stdout.write(chalk.dim("\n  ┌─ shell ──────────────────────────────\n"));
      
      const child = spawn(command, { 
        shell: true, 
        cwd: cwdArg || process.cwd() 
      });
      
      let stdoutData = "";
      let stderrData = "";
      
      child.stdout.on("data", (data) => {
        // We write streaming stdout slightly indented
        const str = data.toString();
        process.stdout.write(chalk.cyan(str));
        stdoutData += str;
      });
      
      child.stderr.on("data", (data) => {
        stderrData += data.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
        resolve(`Error: Command timed out after 30 seconds.\nstderr:\n${stderrData}`);
      }, SHELL_TIMEOUT_MS);

      child.on("close", (code) => {
        clearTimeout(timer);
        process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
        if (code !== 0) {
          resolve(`Error: Command exited with code ${code}\nstderr:\n${stderrData}`);
        } else {
          resolve(stdoutData || "(no output)");
        }
      });
      
      child.on("error", (err) => {
        clearTimeout(timer);
        process.stdout.write(chalk.dim("\n  └────────────────────────────────────────\n"));
        resolve(`Error launching command: ${err.message}`);
      });
    });
  },
};
