import { randomUUID } from "crypto";
import type {
  Client,
  Response as LLMResponse,
  Request as LLMRequest,
  ToolCallData,
  ToolResult,
  Message,
} from "unified-llm";
import {
  systemMessage,
  responseText,
  responseToolCalls,
  responseReasoning,
} from "unified-llm";
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
  Turn,
  SessionEvent,
  EnvironmentContextOptions,
} from "../types/index.js";
import { SessionState, EventKind, DEFAULT_SESSION_CONFIG } from "../types/index.js";
import { EventEmitter } from "../events/event-emitter.js";
import { convertHistoryToMessages, countTurns } from "./history.js";
import { truncateToolOutput } from "../tools/truncation.js";
import { detectLoop } from "./loop-detection.js";
import { discoverProjectDocs } from "../profiles/system-prompt.js";

export class Session {
  readonly id: string;
  providerProfile: ProviderProfile;
  executionEnv: ExecutionEnvironment;
  llmClient: Client;
  config: SessionConfig;
  state: SessionState;
  history: Turn[];
  private emitter: EventEmitter;
  private steeringQueue: string[];
  private followupQueue: string[];
  private abortController: AbortController;
  private gitContext: { isGitRepo: boolean; branch?: string; gitRoot?: string } | null;

  constructor(options: {
    providerProfile: ProviderProfile;
    executionEnv: ExecutionEnvironment;
    llmClient: Client;
    config?: Partial<SessionConfig>;
  }) {
    this.id = randomUUID();
    this.providerProfile = options.providerProfile;
    this.executionEnv = options.executionEnv;
    this.llmClient = options.llmClient;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...options.config };
    this.state = SessionState.IDLE;
    this.history = [];
    this.emitter = new EventEmitter();
    this.steeringQueue = [];
    this.followupQueue = [];
    this.abortController = new AbortController();
    this.gitContext = null;

    this.emit(EventKind.SESSION_START);
  }

  async submit(input: string): Promise<void> {
    this.state = SessionState.PROCESSING;
    await this.processInput(input);
  }

  steer(message: string): void {
    this.steeringQueue.push(message);
  }

  followUp(message: string): void {
    this.followupQueue.push(message);
  }

  events(): AsyncGenerator<SessionEvent> {
    return this.emitter.events();
  }

  async close(): Promise<void> {
    this.abortController.abort();
    this.emit(EventKind.SESSION_END);
    this.state = SessionState.CLOSED;
    this.emitter.close();
  }

  private emit(kind: EventKind, data: Record<string, unknown> = {}): void {
    this.emitter.emit({
      kind,
      timestamp: new Date(),
      sessionId: this.id,
      data,
    });
  }

  private async processInput(userInput: string): Promise<void> {
    // 1. Append UserTurn
    this.history.push({
      kind: "user",
      content: userInput,
      timestamp: new Date(),
    });

    // 2. Emit USER_INPUT
    this.emit(EventKind.USER_INPUT, { content: userInput });

    // 3. Drain steering
    this.drainSteering();

    // 3b. Gather git context (once per session)
    if (this.gitContext === null) {
      this.gitContext = await this.gatherGitContext();
    }

    // 4. Loop
    let roundCount = 0;
    let hadLLMError = false;

    while (true) {
      // a. Check max tool rounds
      if (roundCount >= this.config.maxToolRoundsPerInput) {
        this.emit(EventKind.TURN_LIMIT, {
          reason: "max_tool_rounds_per_input",
          limit: this.config.maxToolRoundsPerInput,
        });
        break;
      }

      // b. Check max turns
      if (this.config.maxTurns > 0 && countTurns(this.history) >= this.config.maxTurns) {
        this.emit(EventKind.TURN_LIMIT, {
          reason: "max_turns",
          limit: this.config.maxTurns,
        });
        break;
      }

      // c. Check abort
      if (this.abortController.signal.aborted) {
        break;
      }

      // d. Build system prompt
      const providerFileNames = this.getProviderFileNames();
      const projectDocs = await discoverProjectDocs(
        this.executionEnv,
        providerFileNames,
        this.gitContext?.gitRoot,
      );
      const envOptions: EnvironmentContextOptions = {
        isGitRepo: this.gitContext?.isGitRepo,
        gitBranch: this.gitContext?.branch,
        modelDisplayName: this.providerProfile.model,
      };
      const systemPrompt = this.providerProfile.buildSystemPrompt(
        this.executionEnv,
        projectDocs,
        envOptions,
      );

      // e. Convert history to messages
      const historyMessages = convertHistoryToMessages(this.history);

      // f. Build LLM request
      const messages: Message[] = [
        systemMessage(systemPrompt),
        ...historyMessages,
      ];

      const providerOptions = this.providerProfile.providerOptions();

      const request: LLMRequest = {
        model: this.providerProfile.model,
        messages,
        tools: this.providerProfile.tools(),
        toolChoice: { mode: "auto" },
        ...(this.config.reasoningEffort
          ? { reasoningEffort: this.config.reasoningEffort }
          : {}),
        provider: this.providerProfile.id,
        ...(providerOptions ? { providerOptions } : {}),
        abortSignal: this.abortController.signal,
      };

      // g. Call LLM
      let response: LLMResponse;
      try {
        response = await this.llmClient.complete(request);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.emit(EventKind.ERROR, { error: errorMessage });
        hadLLMError = true;
        break;
      }

      // h. Extract response data
      const text = responseText(response);
      const toolCalls = responseToolCalls(response);
      const reasoning = responseReasoning(response) || null;
      const usage = response.usage;

      // i. Append AssistantTurn
      this.history.push({
        kind: "assistant",
        content: text,
        toolCalls,
        reasoning,
        usage,
        responseId: response.id,
        timestamp: new Date(),
      });

      // i2. Check context usage
      this.checkContextUsage();

      // j. Emit
      this.emit(EventKind.ASSISTANT_TEXT_END, {
        text,
        toolCallCount: toolCalls.length,
      });

      // k. No tool calls → natural completion
      if (toolCalls.length === 0) {
        break;
      }

      // l. Increment round count
      roundCount++;

      // m. Execute tool calls
      const results = await this.executeToolCalls(toolCalls);

      // n. Append ToolResultsTurn
      this.history.push({
        kind: "tool_results",
        results,
        timestamp: new Date(),
      });

      // o. Drain steering
      this.drainSteering();

      // p. Loop detection
      if (this.config.enableLoopDetection) {
        if (detectLoop(this.history, this.config.loopDetectionWindow)) {
          this.history.push({
            kind: "steering",
            content:
              "Loop detected: You appear to be repeating the same tool calls. Please try a different approach or explain what you are trying to accomplish.",
            timestamp: new Date(),
          });
          this.emit(EventKind.LOOP_DETECTION, {
            windowSize: this.config.loopDetectionWindow,
          });
        }
      }
    }

    // 7. Check abort/error → CLOSED
    if (this.abortController.signal.aborted || hadLLMError) {
      this.state = SessionState.CLOSED;
      this.emit(EventKind.SESSION_END);
      this.emitter.close();
      return;
    }

    // 8. Process follow-ups
    const nextInput = this.followupQueue.shift();
    if (nextInput !== undefined) {
      await this.processInput(nextInput);
      return;
    }

    // 9. Set state
    this.state = SessionState.IDLE;

    // 10. Emit SESSION_END
    this.emit(EventKind.SESSION_END);
  }

  private async executeToolCalls(
    toolCalls: ToolCallData[],
  ): Promise<ToolResult[]> {
    if (
      this.providerProfile.supportsParallelToolCalls &&
      toolCalls.length > 1
    ) {
      return Promise.all(
        toolCalls.map((tc) => this.executeSingleTool(tc)),
      );
    }

    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      results.push(await this.executeSingleTool(tc));
    }
    return results;
  }

  private async executeSingleTool(toolCall: ToolCallData): Promise<ToolResult> {
    // 1. Emit TOOL_CALL_START
    this.emit(EventKind.TOOL_CALL_START, {
      tool_name: toolCall.name,
      call_id: toolCall.id,
    });

    // 2. Look up tool
    const tool = this.providerProfile.toolRegistry.get(toolCall.name);
    if (!tool) {
      const errorMsg = `Tool not found: ${toolCall.name}`;
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        error: errorMsg,
      });
      return { toolCallId: toolCall.id, content: errorMsg, isError: true };
    }

    try {
      // a. Parse arguments
      const args: Record<string, unknown> =
        typeof toolCall.arguments === "string"
          ? (JSON.parse(toolCall.arguments) as Record<string, unknown>)
          : toolCall.arguments;

      // b. Pre-hook interceptor
      const interceptor = this.config.toolCallInterceptor;
      if (interceptor?.pre) {
        const proceed = await interceptor.pre(toolCall.name, args);
        if (!proceed) {
          const skippedMsg = `Tool call skipped by interceptor: ${toolCall.name}`;
          this.emit(EventKind.TOOL_CALL_END, {
            call_id: toolCall.id,
            output: skippedMsg,
          });
          return { toolCallId: toolCall.id, content: skippedMsg, isError: false };
        }
      }

      // c. Execute
      const rawOutput = await tool.executor(args, this.executionEnv);

      // d. Post-hook interceptor
      if (interceptor?.post) {
        await interceptor.post(toolCall.name, args, rawOutput);
      }

      // e. Truncate
      const truncatedOutput = truncateToolOutput(rawOutput, toolCall.name, {
        toolOutputLimits: this.config.toolOutputLimits,
        toolLineLimits: this.config.toolLineLimits,
      });

      // f. Emit TOOL_CALL_END with full output
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        output: rawOutput,
      });

      // g. Return truncated result
      return {
        toolCallId: toolCall.id,
        content: truncatedOutput,
        isError: false,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorMsg = `Tool error (${toolCall.name}): ${errorMessage}`;
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        error: errorMsg,
      });
      return { toolCallId: toolCall.id, content: errorMsg, isError: true };
    }
  }

  private drainSteering(): void {
    while (this.steeringQueue.length > 0) {
      const msg = this.steeringQueue.shift();
      if (msg === undefined) break;
      this.history.push({
        kind: "steering",
        content: msg,
        timestamp: new Date(),
      });
      this.emit(EventKind.STEERING_INJECTED, { content: msg });
    }
  }

  private checkContextUsage(): void {
    let totalChars = 0;
    for (const turn of this.history) {
      if (turn.kind === "user" || turn.kind === "system" || turn.kind === "steering") {
        totalChars += turn.content.length;
      } else if (turn.kind === "assistant") {
        totalChars += turn.content.length;
        if (turn.reasoning) totalChars += turn.reasoning.length;
      } else if (turn.kind === "tool_results") {
        for (const r of turn.results) {
          totalChars += typeof r.content === "string" ? r.content.length : JSON.stringify(r.content).length;
        }
      }
    }
    const estimatedTokens = totalChars / 4;
    const threshold = this.providerProfile.contextWindowSize * 0.8;
    if (estimatedTokens > threshold) {
      this.emit(EventKind.ERROR, {
        type: "context_warning",
        estimatedTokens,
        contextWindowSize: this.providerProfile.contextWindowSize,
        usagePercent: Math.round((estimatedTokens / this.providerProfile.contextWindowSize) * 100),
      });
    }
  }

  private async gatherGitContext(): Promise<{
    isGitRepo: boolean;
    branch?: string;
    gitRoot?: string;
  }> {
    try {
      const check = await this.executionEnv.execCommand(
        "git rev-parse --is-inside-work-tree",
        5_000,
      );
      if (check.exitCode !== 0) return { isGitRepo: false };

      const [branchResult, rootResult] = await Promise.all([
        this.executionEnv.execCommand("git branch --show-current", 5_000),
        this.executionEnv.execCommand("git rev-parse --show-toplevel", 5_000),
      ]);

      return {
        isGitRepo: true,
        branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined,
        gitRoot: rootResult.exitCode === 0 ? rootResult.stdout.trim() || undefined : undefined,
      };
    } catch {
      return { isGitRepo: false };
    }
  }

  private getProviderFileNames(): string[] {
    switch (this.providerProfile.id) {
      case "anthropic":
        return ["CLAUDE.md"];
      case "openai":
        return [".codex/instructions.md"];
      case "gemini":
        return ["GEMINI.md"];
      default:
        return [];
    }
  }
}
