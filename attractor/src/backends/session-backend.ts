import type { Node } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { CodergenBackend, BackendRunOptions } from "../types/handler.js";
import { Session } from "coding-agent/src/session/session.js";
import { Client } from "unified-llm/src/client/client.js";
import type { ProviderProfile } from "coding-agent/src/types/provider-profile.js";
import type { ExecutionEnvironment } from "coding-agent/src/types/execution-env.js";
import type { ToolCallInterceptor } from "coding-agent/src/types/session.js";
import { EventKind } from "coding-agent/src/types/index.js";
import { getStringAttr } from "../types/graph.js";
import { executePreHook, executePostHook } from "../engine/tool-hooks.js";
import { FidelityMode } from "../types/fidelity.js";

export interface SessionBackendConfig {
  providerProfile: ProviderProfile;
  executionEnv: ExecutionEnvironment;
  llmClient: Client;
}

/**
 * A CodergenBackend that uses a coding-agent Session + unified-llm Client
 * to submit prompts and collect responses.
 */
export class SessionBackend implements CodergenBackend {
  private providerProfile: ProviderProfile;
  private executionEnv: ExecutionEnvironment;
  private llmClient: Client;
  private sessionCache = new Map<string, Session>();

  constructor(config: SessionBackendConfig) {
    this.providerProfile = config.providerProfile;
    this.executionEnv = config.executionEnv;
    this.llmClient = config.llmClient;
  }

  async run(
    node: Node,
    prompt: string,
    _context: Context,
    options?: BackendRunOptions,
  ): Promise<string | Outcome> {
    // Optionally override model from node attributes
    const llmModel = getStringAttr(node.attributes, "llm_model");
    const profile =
      llmModel !== ""
        ? { ...this.providerProfile, model: llmModel }
        : this.providerProfile;

    // Build tool call interceptor from hook commands
    let toolCallInterceptor: ToolCallInterceptor | undefined;
    const stageDir = options?.logsRoot ?? "";
    const preHook = options?.preToolHook;
    const postHook = options?.postToolHook;

    if (preHook || postHook) {
      toolCallInterceptor = {};
      if (preHook) {
        toolCallInterceptor.pre = async (toolName, args) => {
          const result = await executePreHook(preHook, toolName, args, stageDir, node.id);
          return result.proceed;
        };
      }
      if (postHook) {
        toolCallInterceptor.post = async (toolName, args, output) => {
          await executePostHook(postHook, toolName, args, output, stageDir, node.id);
        };
      }
    }

    const fidelityMode = options?.fidelityMode;
    const threadId = options?.threadId ?? "";

    // For full mode with a threadId, reuse or create a cached session
    if (fidelityMode === FidelityMode.FULL && threadId !== "") {
      return this.runWithCachedSession(
        threadId,
        profile,
        toolCallInterceptor,
        prompt,
      );
    }

    const session = new Session({
      providerProfile: profile,
      executionEnv: this.executionEnv,
      llmClient: this.llmClient,
      config: toolCallInterceptor ? { toolCallInterceptor } : undefined,
    });

    // Register event consumer BEFORE submit so events are captured
    let assistantText = "";
    const eventConsumer = session.events();
    const collectEvents = (async () => {
      for await (const event of eventConsumer) {
        if (event.kind === EventKind.ASSISTANT_TEXT_END) {
          const text = event.data["text"];
          if (typeof text === "string") {
            assistantText = text;
          }
        }
        if (event.kind === EventKind.INPUT_COMPLETE) break;
      }
    })();

    await session.submit(prompt);
    await session.close();
    await collectEvents;
    return assistantText;
  }

  private async runWithCachedSession(
    threadId: string,
    profile: ProviderProfile,
    toolCallInterceptor: ToolCallInterceptor | undefined,
    prompt: string,
  ): Promise<string> {
    let session = this.sessionCache.get(threadId);

    if (!session) {
      session = new Session({
        providerProfile: profile,
        executionEnv: this.executionEnv,
        llmClient: this.llmClient,
        config: toolCallInterceptor ? { toolCallInterceptor } : undefined,
      });
      this.sessionCache.set(threadId, session);
    }

    // Register event consumer BEFORE submit so events are captured
    let assistantText = "";
    const eventConsumer = session.events();
    const collectEvents = (async () => {
      for await (const event of eventConsumer) {
        if (event.kind === EventKind.ASSISTANT_TEXT_END) {
          const text = event.data["text"];
          if (typeof text === "string") {
            assistantText = text;
          }
        }
        if (event.kind === EventKind.INPUT_COMPLETE) break;
      }
    })();

    await session.submit(prompt);
    await collectEvents;

    // Do not close cached sessions - they are reused
    return assistantText;
  }
}
