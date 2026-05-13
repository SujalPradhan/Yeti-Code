/**
 * spinner.ts — Terminal spinner for loading states.
 * Shows an animated spinner with a message and hides it when done.
 */

import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL_MS = 80;

export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private message: string;
  private isActive = false;

  constructor(message: string = "Thinking") {
    this.message = message;
  }

  start(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.frame = 0;

    this.timer = setInterval(() => {
      const icon = chalk.cyan(FRAMES[this.frame % FRAMES.length]);
      process.stdout.write(`\r  ${icon}  ${chalk.dim(this.message)}  `);
      this.frame++;
    }, INTERVAL_MS);
  }

  /** Clear the spinner line and optionally print a final message. */
  stop(finalMessage?: string): void {
    if (!this.isActive) return;
    this.isActive = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // Clear the spinner line
    process.stdout.write("\r\x1b[2K");

    if (finalMessage) {
      console.log(finalMessage);
    }
  }

  update(message: string): void {
    this.message = message;
  }
}
