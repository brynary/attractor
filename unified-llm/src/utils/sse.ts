export interface SSEEvent {
  event: string;
  data: string;
  retry?: number;
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";
  let dataLines: string[] = [];
  let currentRetry: number | undefined;

  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Flush any remaining event
        if (dataLines.length > 0) {
          const data = dataLines.join("\n");
          if (currentRetry !== undefined) {
            yield { event: currentEvent, data, retry: currentRetry };
          } else {
            yield { event: currentEvent, data };
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "" || line === "\r") {
          // Blank line = event boundary
          if (dataLines.length > 0) {
            const data = dataLines.join("\n");
            if (currentRetry !== undefined) {
              yield { event: currentEvent, data, retry: currentRetry };
            } else {
              yield { event: currentEvent, data };
            }
            dataLines = [];
            currentEvent = "message";
            currentRetry = undefined;
          }
          continue;
        }

        // Strip trailing \r
        const cleanLine = line.endsWith("\r") ? line.slice(0, -1) : line;

        if (cleanLine.startsWith(":")) {
          // Comment line, skip
          continue;
        }

        const colonIndex = cleanLine.indexOf(":");
        if (colonIndex === -1) {
          // Field with no value
          continue;
        }

        const field = cleanLine.slice(0, colonIndex);
        let value_ = cleanLine.slice(colonIndex + 1);
        if (value_.startsWith(" ")) {
          value_ = value_.slice(1);
        }

        if (field === "event") {
          currentEvent = value_;
        } else if (field === "data") {
          dataLines.push(value_);
        } else if (field === "retry") {
          const retryValue = Number(value_);
          if (Number.isFinite(retryValue) && retryValue >= 0) {
            currentRetry = retryValue;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
