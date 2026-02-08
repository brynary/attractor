import { describe, test, expect } from "bun:test";
import { OpenAICompatibleAdapter } from "../../../src/providers/openai-compatible/adapter.js";
import { RateLimitError } from "../../../src/types/errors.js";

describe("OpenAICompatibleAdapter", () => {
  test("extracts Retry-After header on 429 rate limit", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          JSON.stringify({ error: { message: "Rate limited" } }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "30",
            },
          },
        );
      },
    });

    try {
      const adapter = new OpenAICompatibleAdapter({
        baseUrl: `http://localhost:${server.port}`,
      });

      let caught: unknown;
      try {
        await adapter.complete({
          model: "test-model",
          messages: [],
        });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(RateLimitError);
      expect((caught as RateLimitError).retryAfter).toBe(30);
    } finally {
      server.stop(true);
    }
  });
});
