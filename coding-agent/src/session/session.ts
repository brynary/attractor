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
  StreamEventType,
  StreamAccumulator,
} from "unified-llm";
import type {
  ProviderProfile,
  ExecutionEnvironment,
  SessionConfig,
  Turn,
  SessionEvent,
  EnvironmentContextOptions,
  ToolRegistry,
} from "../types/index.js";
import { SessionState, EventKind, DEFAULT_SESSION_CONFIG } from "../types/index.js";
import type {
  SubAgentHandle,
  SubAgentDepthConfig,
  SessionFactory,
  SubAgentResult,
} from "../tools/subagent-tools.js";
import {
  createSpawnAgentTool,
  createSendInputTool,
  createWaitTool,
  createCloseAgentTool,
} from "../tools/subagent-tools.js";
import { EventEmitter } from "../events/event-emitter.js";
import { convertHistoryToMessages, countTurns } from "./history.js";
import { truncateToolOutput } from "../tools/truncation.js";
import { validateToolArgs } from "../tools/validate-args.js";
import { detectLoop } from "./loop-detection.js";
import { discoverProjectDocs } from "../profiles/system-prompt.js";
import { createOpenAIProfile } from "../profiles/openai-profile.js";
import { createAnthropicProfile } from "../profiles/anthropic-profile.js";
import { createGeminiProfile } from "../profiles/gemini-profile.js";
import { scopeExecutionEnvironment } from "../env/scoped-env.js";

const SUBAGENT_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "wait",
  "close_agent",
]);

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
  subagents: Map<string, SubAgentHandle>;
  private subagentDepthConfig: SubAgentDepthConfig;
  private abortController: AbortController;
  private runningAbortControllers: Set<AbortController>;
  private runningToolPromises: Set<Promise<void>>;
  private closingPromise: Promise<void> | null;
  private gitContext: { isGitRepo: boolean; branch?: string; gitRoot?: string; modifiedCount?: number; untrackedCount?: number; recentCommits?: string[] } | null;

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
    const defaultCommandTimeoutMs =
      options.config?.defaultCommandTimeoutMs ??
      providerDefaultCommandTimeoutMs(options.providerProfile.id);
    const maxCommandTimeoutMs =
      options.config?.maxCommandTimeoutMs ??
      DEFAULT_SESSION_CONFIG.maxCommandTimeoutMs;
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      ...options.config,
      defaultCommandTimeoutMs,
      maxCommandTimeoutMs,
    };
    this.state = SessionState.IDLE;
    this.history = [];
    this.emitter = new EventEmitter();
    this.steeringQueue = [];
    this.followupQueue = [];
    this.subagents = new Map();
    const profileDepth = this.providerProfile.subagentDepthConfig;
    this.subagentDepthConfig = {
      currentDepth: profileDepth?.currentDepth ?? 0,
      maxDepth: this.config.maxSubagentDepth,
    };
    this.abortController = new AbortController();
    this.runningAbortControllers = new Set();
    this.runningToolPromises = new Set();
    this.closingPromise = null;
    this.gitContext = null;

    this.ensureSubagentToolsRegistered();

    this.emit(EventKind.SESSION_START);
  }

  async submit(input: string): Promise<void> {
    if (this.state === SessionState.CLOSED) {
      throw new Error("Cannot submit to a closed session");
    }
    if (this.state === SessionState.PROCESSING) {
      throw new Error("Cannot submit while session is processing");
    }
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
    if (this.state === SessionState.CLOSED) {
      return;
    }
    if (this.closingPromise !== null) {
      return this.closingPromise;
    }
    this.closingPromise = this.performClose();
    return this.closingPromise;
  }

  private async performClose(): Promise<void> {
    this.abortController.abort();
    for (const controller of this.runningAbortControllers) {
      controller.abort();
    }
    this.runningAbortControllers.clear();
    // Await running tool executions with a bounded 5s timeout
    if (this.runningToolPromises.size > 0) {
      const pending = Promise.allSettled([...this.runningToolPromises]);
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5_000));
      await Promise.race([pending, timeout]);
    }
    for (const [, agent] of this.subagents) {
      await agent.close();
    }
    this.subagents.clear();
    this.state = SessionState.CLOSED;
    this.emit(EventKind.SESSION_END, { state: this.state });
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

    // 4. Prepare values needed for system prompt (git context gathered above)
    const providerFileNames = this.getProviderFileNames();
    const envOptions: EnvironmentContextOptions = {
      isGitRepo: this.gitContext?.isGitRepo,
      gitBranch: this.gitContext?.branch,
      modifiedCount: this.gitContext?.modifiedCount,
      untrackedCount: this.gitContext?.untrackedCount,
      recentCommits: this.gitContext?.recentCommits,
      modelDisplayName: this.providerProfile.model,
      knowledgeCutoff: this.providerProfile.knowledgeCutoff,
    };

    // 5. Loop
    let roundCount = 0;
    let hadLLMError = false;

    while (true) {
      // 5a. Rebuild system prompt each tool round so project docs stay fresh
      const projectDocs = await discoverProjectDocs(
        this.executionEnv,
        providerFileNames,
        this.gitContext?.gitRoot,
      );
      const systemPrompt = this.providerProfile.buildSystemPrompt(
        this.executionEnv,
        projectDocs,
        envOptions,
        this.config.userInstructions,
      );
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

      // d. Convert history to messages
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

      // g. Call LLM (streaming or non-streaming)
      let response: LLMResponse;
      const useStreaming =
        this.config.enableStreaming &&
        this.providerProfile.supportsStreaming;

      try {
        if (useStreaming) {
          response = await this.callLLMStreaming(request);
        } else {
          response = await this.llmClient.complete(request);
        }
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.emit(EventKind.ERROR, { error: errorMessage });
        if (isContextOverflowError(errorMessage)) {
          this.emit(EventKind.WARNING, {
            type: "context_overflow",
            message:
              "Context window overflow detected. The session is closing without automatic compaction.",
            error: errorMessage,
          });
        }
        if (isUnrecoverableError(errorMessage)) {
          hadLLMError = true;
        }
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

      // j. Emit (non-streaming path emits ASSISTANT_TEXT_END here;
      //    streaming path already emitted START/DELTA/END in callLLMStreaming)
      if (!useStreaming) {
        if (text.length > 0) {
          this.emit(EventKind.ASSISTANT_TEXT_START);
        }
        this.emit(EventKind.ASSISTANT_TEXT_END, {
          text,
          reasoning,
          toolCallCount: toolCalls.length,
        });
      }

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
          const warning = `Loop detected: the last ${this.config.loopDetectionWindow} tool calls follow a repeating pattern. Try a different approach.`;
          this.history.push({
            kind: "steering",
            content: warning,
            timestamp: new Date(),
          });
          this.emit(EventKind.LOOP_DETECTION, {
            message: warning,
          });
        }
      }
    }

    // 7. Check abort/error → CLOSED
    if (this.abortController.signal.aborted || hadLLMError) {
      await this.close();
      return;
    }

    // 8. Process follow-ups
    const nextInput = this.followupQueue.shift();
    if (nextInput !== undefined) {
      await this.processInput(nextInput);
      return;
    }

    // 9. Set state based on whether the last assistant response appears to ask
    //    the user for additional input.
    const lastAssistant = this.history.findLast((t) => t.kind === "assistant");
    const askedQuestion =
      lastAssistant?.kind === "assistant" &&
      lastAssistant.toolCalls.length === 0 &&
      this.isAwaitingInput(lastAssistant.content);
    this.state = askedQuestion ? SessionState.AWAITING_INPUT : SessionState.IDLE;

    // 10. Emit INPUT_COMPLETE
    // Spec pseudocode (§2.5) emits SESSION_END here, but the EventKind definition
    // says "SESSION_END -- session closed (includes final state)". We emit
    // INPUT_COMPLETE to signal one input cycle is done, and reserve SESSION_END
    // for close() when the session is actually terminated.
    this.emit(EventKind.INPUT_COMPLETE);
  }

  private async executeToolCalls(
    toolCalls: ToolCallData[],
  ): Promise<ToolResult[]> {
    if (
      this.providerProfile.supportsParallelToolCalls &&
      toolCalls.length > 1
    ) {
      return Promise.all(
        toolCalls.map((tc) => this.trackToolExecution(tc)),
      );
    }

    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      results.push(await this.trackToolExecution(tc));
    }
    return results;
  }

  private trackToolExecution(toolCall: ToolCallData): Promise<ToolResult> {
    const promise = this.executeSingleTool(toolCall);
    const tracked = promise.then(
      () => undefined,
      () => undefined,
    );
    this.runningToolPromises.add(tracked);
    tracked.then(() => { this.runningToolPromises.delete(tracked); });
    return promise;
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

    // 3. Parse arguments (before execution try/catch)
    let args: Record<string, unknown>;
    try {
      args =
        typeof toolCall.arguments === "string"
          ? (JSON.parse(toolCall.arguments) as Record<string, unknown>)
          : toolCall.arguments;
    } catch (parseError: unknown) {
      const parseMsg = parseError instanceof Error ? parseError.message : String(parseError);
      const errorMsg = `Invalid JSON arguments for tool ${toolCall.name}: ${parseMsg}`;
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        error: errorMsg,
      });
      return { toolCallId: toolCall.id, content: errorMsg, isError: true };
    }

    // 3b. Inject session config timeouts for shell tool
    if (toolCall.name === "shell") {
      const requestedTimeout = args.timeout_ms as number | undefined;
      const effectiveTimeout = requestedTimeout ?? this.config.defaultCommandTimeoutMs;
      args = { ...args, timeout_ms: Math.min(effectiveTimeout, this.config.maxCommandTimeoutMs) };
    }

    // 4. Validate arguments against schema (before execution try/catch)
    const validationError = validateToolArgs(args, tool.definition.parameters);
    if (validationError !== null) {
      const errorMsg = `Validation error for tool ${toolCall.name}: ${validationError}`;
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        error: errorMsg,
      });
      return { toolCallId: toolCall.id, content: errorMsg, isError: true };
    }

    // 5. Create per-tool AbortController linked to session abort
    const toolAbortController = new AbortController();
    const onSessionAbort = () => toolAbortController.abort();
    this.abortController.signal.addEventListener("abort", onSessionAbort);
    this.runningAbortControllers.add(toolAbortController);

    try {
      // a. Pre-hook interceptor
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

      // b. Execute
      const rawOutput = await tool.executor(args, this.executionEnv, toolAbortController.signal);

      // b2. Emit output delta (batch emit of full output, not truly incremental
      //     streaming; tool execution is non-streaming so the full output is
      //     emitted as a single delta)
      this.emit(EventKind.TOOL_CALL_OUTPUT_DELTA, {
        call_id: toolCall.id,
        delta: rawOutput,
      });

      // c. Post-hook interceptor
      if (interceptor?.post) {
        await interceptor.post(toolCall.name, args, rawOutput);
      }

      // d. Truncate
      const truncatedOutput = truncateToolOutput(rawOutput, toolCall.name, {
        toolOutputLimits: this.config.toolOutputLimits,
        toolLineLimits: this.config.toolLineLimits,
      });

      // e. Emit TOOL_CALL_END with full output
      this.emit(EventKind.TOOL_CALL_END, {
        call_id: toolCall.id,
        output: rawOutput,
      });

      // f. Return truncated result
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
    } finally {
      this.runningAbortControllers.delete(toolAbortController);
      this.abortController.signal.removeEventListener("abort", onSessionAbort);
    }
  }

  private ensureSubagentToolsRegistered(): void {
    const registry = this.providerProfile.toolRegistry;
    const depthConfig = this.getSubagentDepthConfig();
    const sessionFactory =
      this.providerProfile.subagentSessionFactory ?? this.createInternalSubagentFactory();
    registry.register(createSpawnAgentTool(sessionFactory, this.subagents, depthConfig));
    registry.register(createSendInputTool(this.subagents));
    registry.register(createWaitTool(this.subagents));
    registry.register(createCloseAgentTool(this.subagents));
  }

  private getSubagentDepthConfig(): SubAgentDepthConfig {
    this.subagentDepthConfig.maxDepth = this.config.maxSubagentDepth;
    return this.subagentDepthConfig;
  }

  private createInternalSubagentFactory(): SessionFactory {
    return async ({
      task,
      workingDir,
      model,
      maxTurns,
      depthConfig,
      executionEnv,
    }) => {
      const effectiveDepth = depthConfig ?? {
        currentDepth: this.getSubagentDepthConfig().currentDepth + 1,
        maxDepth: this.config.maxSubagentDepth,
      };
      const baseExecutionEnv = executionEnv ?? this.executionEnv;
      const childExecutionEnv =
        workingDir !== undefined
          ? scopeExecutionEnvironment(baseExecutionEnv, workingDir)
          : baseExecutionEnv;
      const childProfile = this.createChildProfileForSubagent(
        model ?? this.providerProfile.model,
        effectiveDepth,
      );
      const childSession = new Session({
        providerProfile: childProfile,
        executionEnv: childExecutionEnv,
        llmClient: this.llmClient,
        config: {
          ...this.config,
          maxTurns: maxTurns ?? 50,
          maxSubagentDepth: this.config.maxSubagentDepth,
        },
      });

      let lastResult: SubAgentResult = {
        output: "",
        success: true,
        turnsUsed: countTurns(childSession.history),
      };
      let queue = Promise.resolve(lastResult);
      let activeRun: Promise<SubAgentResult> | null = null;

      const runInput = async (input: string): Promise<SubAgentResult> => {
        handle.status = "running";
        try {
          await childSession.submit(input);
          const waitingForInput =
            childSession.state === SessionState.AWAITING_INPUT;
          const success = childSession.state !== SessionState.CLOSED;
          if (!success) {
            handle.status = "failed";
          } else {
            handle.status = waitingForInput ? "running" : "completed";
          }
          lastResult = {
            output: this.lastAssistantOutputFromHistory(childSession.history),
            success,
            turnsUsed: countTurns(childSession.history),
          };
          return lastResult;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          handle.status = "failed";
          lastResult = {
            output: `Subagent error: ${errorMessage}`,
            success: false,
            turnsUsed: countTurns(childSession.history),
          };
          return lastResult;
        }
      };

      const enqueue = (input: string): Promise<SubAgentResult> => {
        const run = queue.then(() => runInput(input));
        activeRun = run;
        queue = run.then(
          (result) => {
            lastResult = result;
            activeRun = null;
            return result;
          },
          (error) => {
            activeRun = null;
            throw error;
          },
        );
        return run;
      };

      const handle: SubAgentHandle = {
        id: childSession.id,
        status: "running",
        session: childSession,
        submit: async (input: string): Promise<void> => {
          await enqueue(input);
        },
        waitForCompletion: async (): Promise<SubAgentResult> => {
          if (activeRun) {
            return activeRun;
          }
          return lastResult;
        },
        close: async (): Promise<void> => {
          await childSession.close();
          if (handle.status === "running") {
            handle.status = "failed";
          }
        },
      };

      void enqueue(task);
      return handle;
    };
  }

  private createChildProfileForSubagent(
    model: string,
    depthConfig: SubAgentDepthConfig,
  ): ProviderProfile {
    let childProfile: ProviderProfile;
    switch (this.providerProfile.id) {
      case "openai":
        childProfile = createOpenAIProfile(model, {
          subagentConfig: depthConfig,
        });
        break;
      case "anthropic":
        childProfile = createAnthropicProfile(model, {
          subagentConfig: depthConfig,
        });
        break;
      case "gemini":
        childProfile = createGeminiProfile(model, {
          subagentConfig: depthConfig,
        });
        break;
      default:
        childProfile = this.providerProfile;
        break;
    }

    if (childProfile !== this.providerProfile) {
      this.copyParentToolsForSubagent(childProfile.toolRegistry);
    }
    return childProfile;
  }

  private copyParentToolsForSubagent(childRegistry: ToolRegistry): void {
    for (const tool of this.providerProfile.toolRegistry.entries()) {
      if (SUBAGENT_TOOL_NAMES.has(tool.definition.name)) {
        continue;
      }
      childRegistry.register(tool);
    }
  }

  private lastAssistantOutputFromHistory(history: readonly Turn[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      if (turn?.kind === "assistant" && turn.content.trim().length > 0) {
        return turn.content;
      }
    }
    return "";
  }

  private async callLLMStreaming(request: LLMRequest): Promise<LLMResponse> {
    const accumulator = new StreamAccumulator(request.provider);
    let emittedTextStart = false;

    for await (const event of this.llmClient.stream(request)) {
      accumulator.process(event);

      switch (event.type) {
        case StreamEventType.TEXT_DELTA: {
          if (!emittedTextStart) {
            this.emit(EventKind.ASSISTANT_TEXT_START);
            emittedTextStart = true;
          }
          this.emit(EventKind.ASSISTANT_TEXT_DELTA, { delta: event.delta });
          break;
        }
        case StreamEventType.ERROR: {
          throw event.error;
        }
      }
    }

    const response = accumulator.response();
    const fullText = responseText(response);

    this.emit(EventKind.ASSISTANT_TEXT_END, {
      text: fullText,
      reasoning: responseReasoning(response) || null,
      toolCallCount: responseToolCalls(response).length,
    });

    return response;
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

  private isAwaitingInput(text: string): boolean {
    if (this.config.awaitingInputDetector) {
      return this.config.awaitingInputDetector(text);
    }

    const trimmed = text.trim();
    if (!trimmed.endsWith("?")) {
      return false;
    }

    const lower = trimmed.toLowerCase();
    return /\b(can you|could you|would you|would you like|want me to|please|please provide|please share|which|what|where|when|who|how)\b/.test(lower);
  }

  private checkContextUsage(): void {
    let totalChars = 0;
    for (const turn of this.history) {
      if (turn.kind === "user" || turn.kind === "system" || turn.kind === "steering") {
        totalChars += turn.content.length;
      } else if (turn.kind === "assistant") {
        totalChars += turn.content.length;
        if (turn.reasoning) totalChars += turn.reasoning.length;
        for (const tc of turn.toolCalls) {
          totalChars += tc.name.length;
          totalChars += typeof tc.arguments === "string"
            ? tc.arguments.length
            : JSON.stringify(tc.arguments).length;
        }
      } else if (turn.kind === "tool_results") {
        for (const r of turn.results) {
          totalChars += typeof r.content === "string" ? r.content.length : JSON.stringify(r.content).length;
        }
      }
    }
    const estimatedTokens = totalChars / 4;
    const threshold = this.providerProfile.contextWindowSize * 0.8;
    if (estimatedTokens > threshold) {
      const usagePercent = Math.round((estimatedTokens / this.providerProfile.contextWindowSize) * 100);
      this.emit(EventKind.WARNING, {
        type: "context_warning",
        estimatedTokens,
        contextWindowSize: this.providerProfile.contextWindowSize,
        usagePercent,
        message: `Context usage at ~${usagePercent}% of context window`,
      });
    }
  }

  private async gatherGitContext(): Promise<{
    isGitRepo: boolean;
    branch?: string;
    gitRoot?: string;
    modifiedCount?: number;
    untrackedCount?: number;
    recentCommits?: string[];
  }> {
    try {
      const check = await this.executionEnv.execCommand(
        "git rev-parse --is-inside-work-tree",
        5_000,
      );
      if (check.exitCode !== 0) return { isGitRepo: false };

      const [branchResult, rootResult, statusResult, logResult] = await Promise.all([
        this.executionEnv.execCommand("git branch --show-current", 5_000),
        this.executionEnv.execCommand("git rev-parse --show-toplevel", 5_000),
        this.executionEnv.execCommand("git status --porcelain", 5_000),
        this.executionEnv.execCommand("git log --oneline -10", 5_000),
      ]);

      let modifiedCount: number | undefined;
      let untrackedCount: number | undefined;
      if (statusResult.exitCode === 0) {
        const statusLines = statusResult.stdout.trim().split("\n").filter(Boolean);
        modifiedCount = statusLines.filter((l) => !l.startsWith("??")).length;
        untrackedCount = statusLines.filter((l) => l.startsWith("??")).length;
      }

      let recentCommits: string[] | undefined;
      if (logResult.exitCode === 0 && logResult.stdout.trim()) {
        recentCommits = logResult.stdout.trim().split("\n").filter(Boolean);
      }

      return {
        isGitRepo: true,
        branch: branchResult.exitCode === 0 ? branchResult.stdout.trim() || undefined : undefined,
        gitRoot: rootResult.exitCode === 0 ? rootResult.stdout.trim() || undefined : undefined,
        modifiedCount,
        untrackedCount,
        recentCommits,
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

/** Returns true if the error indicates an unrecoverable failure (auth, context overflow). */
function isUnrecoverableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("authentication") ||
    lower.includes("auth") ||
    lower.includes("unauthorized") ||
    lower.includes("403") ||
    lower.includes("401") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    isContextOverflowError(lower)
  );
}

function isContextOverflowError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("context_length_exceeded") ||
    lower.includes("context overflow") ||
    lower.includes("context window") ||
    lower.includes("max_tokens") ||
    lower.includes("maximum context length")
  );
}

function providerDefaultCommandTimeoutMs(providerId: string): number {
  switch (providerId) {
    case "anthropic":
      return 120_000;
    case "openai":
    case "gemini":
    default:
      return 10_000;
  }
}
