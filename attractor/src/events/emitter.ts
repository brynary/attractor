import type { PipelineEvent } from "../types/index.js";

interface Consumer {
  queue: PipelineEvent[];
  waiters: Array<(event: PipelineEvent | null) => void>;
  closed: boolean;
}

export class PipelineEventEmitter {
  private consumers: Consumer[] = [];

  emit(event: PipelineEvent): void {
    for (const consumer of this.consumers) {
      if (consumer.closed) continue;

      const waiter = consumer.waiters.shift();
      if (waiter) {
        waiter(event);
      } else {
        consumer.queue.push(event);
      }
    }
  }

  events(): AsyncGenerator<PipelineEvent> {
    // Register the consumer eagerly so events emitted before
    // the first next() call are captured in the queue.
    const consumer: Consumer = { queue: [], waiters: [], closed: false };
    this.consumers.push(consumer);
    const consumers = this.consumers;

    async function* generate(): AsyncGenerator<PipelineEvent> {
      try {
        while (true) {
          const queued = consumer.queue.shift();
          if (queued) {
            yield queued;
          } else if (consumer.closed) {
            break;
          } else {
            const event = await new Promise<PipelineEvent | null>((resolve) => {
              consumer.waiters.push(resolve);
            });
            if (event === null) break;
            yield event;
          }
        }
      } finally {
        consumer.closed = true;
        const idx = consumers.indexOf(consumer);
        if (idx >= 0) consumers.splice(idx, 1);
      }
    }

    return generate();
  }

  close(): void {
    for (const consumer of this.consumers) {
      consumer.closed = true;
      for (const waiter of consumer.waiters) {
        waiter(null);
      }
      consumer.waiters.length = 0;
    }
  }
}
