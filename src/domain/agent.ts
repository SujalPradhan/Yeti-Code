import type * as readline from "readline";
import type { AppConfig } from "../core/config";
import type { SessionLogger } from "../core/logger";
import type { ConversationContext } from "./context";
import type { ToolRegistry } from "../features/tools/registry";
import type { SkillRegistry } from "../features/skills/registry";
import type { LLMProvider, FunctionDeclaration } from "../infrastructure/llm/types";
import type { Content } from "./types";
import type { ToolContext } from "../features/tools/types";

export interface AgentContext {
  config: AppConfig;
  ctx: ConversationContext;
  toolRegistry: ToolRegistry;
  skillRegistry: SkillRegistry;
  rl: readline.Interface;
  logger: SessionLogger;
  provider: LLMProvider;
  supportsTools: boolean;
  /** Tool names that should remain available even if the active skill filters tools. */
  forcedToolNames?: string[];
  /** Extra fields merged into ToolContext for each tool dispatch (e.g. teamOrchestrator) */
  toolContextExtras?: Partial<ToolContext>;
  callbacks: {
    onTurnStart: () => void;
    onToken: (token: string) => void;
    onToolCall: (name: string, args: Record<string, unknown>) => void;
    onToolResult: (name: string, result: string) => void;
    onMaxTurns: (maxTurns: number) => void;
    onAskConfirm: (msg: string) => Promise<boolean>;
  };
}

export async function agentLoop(agentCtx: AgentContext): Promise<void> {
  const {
    config,
    ctx,
    toolRegistry,
    skillRegistry,
    provider,
    callbacks,
  } = agentCtx;

  let turns = 0;
  const activeSkill = skillRegistry.getActive();

  // Filter tools based on skill
  let availableToolDefs: FunctionDeclaration[] = toolRegistry.toFunctionDeclarations();
  const forcedToolNames = new Set(agentCtx.forcedToolNames ?? []);
  if (activeSkill.tools) {
    availableToolDefs = availableToolDefs.filter((t) =>
      activeSkill.tools?.includes(t.name) || forcedToolNames.has(t.name),
    );
  }
  const toolsParam = agentCtx.supportsTools && availableToolDefs.length > 0 ? availableToolDefs : undefined;

  // Model override from skill
  const model = activeSkill.model || config.model;

  while (turns < config.maxTurns) {
    callbacks.onTurnStart();

    const result = await provider.streamChat({
      model,
      systemInstruction: ctx.getSystemInstruction(),
      contents: ctx.getMessages(),
      tools: toolsParam,
      writeToken: callbacks.onToken,
    });

    // ── Case 1: plain text response (no function calls) ─────────────
    if (result.functionCalls.length === 0) {
      const modelMsg: Content = {
        role: "model",
        parts: [{ text: result.text }],
      };
      ctx.addMessage(modelMsg);
      ctx.setLastUsage(result);
      return;
    }

    // ── Case 2: function calls ──────────────────────────────────────
    turns++;

    const modelMsg: Content = {
      role: "model",
      parts: result.functionCalls.map((fc) => ({
        functionCall: fc,
      })),
    };
    ctx.addMessage(modelMsg);

    const responseParts: Content["parts"] = [];

    for (const fc of result.functionCalls) {
      const toolName = fc.name ?? "unknown";
      const toolArgs = (fc.args as Record<string, unknown>) ?? {};

      callbacks.onToolCall(toolName, toolArgs);

      const toolContext = {
        logger: agentCtx.logger,
        confirm: callbacks.onAskConfirm,
        ...agentCtx.toolContextExtras,
      };

      const toolResult = await toolRegistry.dispatch(toolName, toolArgs, toolContext);

      callbacks.onToolResult(toolName, toolResult);

      responseParts.push({
        functionResponse: {
          name: toolName,
          id: fc.id,
          response: { result: toolResult },
        },
      });
    }

    const userResponseMsg: Content = {
      role: "user",
      parts: responseParts,
    };
    ctx.addMessage(userResponseMsg);

    if (turns >= config.maxTurns) {
      callbacks.onMaxTurns(config.maxTurns);
      return;
    }
  }
}
