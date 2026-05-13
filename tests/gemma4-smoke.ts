/**
 * One-off smoke test: does gemma4:e4b emit tool_calls that our
 * OllamaProvider's streaming parser actually recognises?
 *
 * Run:  npx ts-node tests/gemma4-smoke.ts
 */

import { OllamaProvider } from "../src/infrastructure/llm/ollama";
import type { FunctionDeclaration } from "../src/infrastructure/llm/types";

const MODEL = process.env["MODEL"] ?? "gemma4:e4b";

const tools: FunctionDeclaration[] = [
  {
    name: "get_weather",
    description: "Get the current weather for a given city.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. 'Chennai'" },
        unit: { type: "string", description: "celsius or fahrenheit" },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List files in a directory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

const prompts = [
  {
    label: "weather (single tool call expected)",
    text: "What is the weather in Chennai right now in celsius? Use the get_weather tool.",
  },
  {
    label: "ls (single tool call expected)",
    text: "List the files in the current directory. Use the list_files tool with path='.'",
  },
  {
    label: "plain text (no tool call expected)",
    text: "Say the word 'pong' and nothing else.",
  },
];

async function run(): Promise<void> {
  const provider = new OllamaProvider();

  const ok = await provider.isAvailable();
  if (!ok) {
    console.error("Ollama is not reachable on http://localhost:11434");
    process.exit(1);
  }

  console.log(`# gemma4 tool-calling smoke test`);
  console.log(`# model: ${MODEL}\n`);

  let passed = 0;
  let failed = 0;

  for (const p of prompts) {
    process.stdout.write(`──  ${p.label}\n   prompt: ${p.text}\n   `);
    let streamed = "";
    const t0 = Date.now();
    try {
      const result = await provider.streamChat({
        model: MODEL,
        systemInstruction:
          "You are a helpful assistant. When a tool fits the user's request, call it. Do not answer in prose if a tool would answer.",
        contents: [{ role: "user", parts: [{ text: p.text }] }],
        tools,
        writeToken: (t) => {
          streamed += t;
        },
      });
      const ms = Date.now() - t0;
      const fcCount = result.functionCalls.length;

      console.log(
        `[${ms}ms] text=${JSON.stringify(streamed.slice(0, 40))} ` +
          `tool_calls=${fcCount}`,
      );
      for (const fc of result.functionCalls) {
        console.log(`     · ${fc.name}(${JSON.stringify(fc.args)})`);
      }

      // Verdict per prompt
      const expectsTool = p.label.includes("expected") && !p.label.includes("no tool");
      if (expectsTool) {
        if (fcCount > 0) {
          console.log(`     ✓ tool call detected\n`);
          passed++;
        } else {
          console.log(`     ✗ NO tool call — Gemma 4 parser bug suspected (text was: ${JSON.stringify(streamed)})\n`);
          failed++;
        }
      } else {
        if (fcCount === 0) {
          console.log(`     ✓ no tool call (as expected)\n`);
          passed++;
        } else {
          console.log(`     ! unexpected tool call\n`);
          failed++;
        }
      }
    } catch (e) {
      console.log(`ERROR: ${(e as Error).message}\n`);
      failed++;
    }
  }

  console.log(`\nResult: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(2);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
