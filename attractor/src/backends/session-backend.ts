import type { Node } from "../types/graph.js";
import type { Context } from "../types/context.js";
import type { Outcome } from "../types/outcome.js";
import type { CodergenBackend } from "../types/handler.js";
import { Session } from "coding-agent/src/session/session.js";
import { Client } from "unified-llm/src/client/client.js";
import type { ProviderProfile } from "coding-agent/src/types/provider-profile.js";
import type { ExecutionEnvironment } from "coding-agent/src/types/execution-env.js";
import { EventKind } from "coding-agent/src/types/index.js";
import { getStringAttr } from "../types/graph.js";

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

  constructor(config: SessionBackendConfig) {
    this.providerProfile = config.providerProfile;
    this.executionEnv = config.executionEnv;
    this.llmClient = config.llmClient;
  }

  async run(
    node: Node,
    prompt: string,
    _context: Context,
  ): Promise<string | Outcome> {
    // Optionally override model from node attributes
    const llmModel = getStringAttr(node.attributes, "llm_model");
    const profile =
      llmModel !== ""
        ? { ...this.providerProfile, model: llmModel }
        : this.providerProfile;

    const session = new Session({
      providerProfile: profile,
      executionEnv: this.executionEnv,
      llmClient: this.llmClient,
    });

    await session.submit(prompt);

    // Collect assistant text from session events
    let assistantText = "";
    for await (const event of session.events()) {
      if (event.kind === EventKind.ASSISTANT_TEXT_END) {
        const text = event.data["text"];
        if (typeof text === "string") {
          assistantText = text;
        }
      }
    }

    await session.close();
    return assistantText;
  }
}
