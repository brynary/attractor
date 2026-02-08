export type ContextValue = string | number | boolean;

export class Context {
  private values: Map<string, ContextValue>;
  private logEntries: string[];

  constructor() {
    this.values = new Map();
    this.logEntries = [];
  }

  set(key: string, value: ContextValue): void {
    this.values.set(key, value);
  }

  get(key: string, defaultValue?: ContextValue): ContextValue | undefined {
    return this.values.get(key) ?? defaultValue;
  }

  getString(key: string, defaultValue: string = ""): string {
    const value = this.values.get(key);
    if (value === undefined) {
      return defaultValue;
    }
    return String(value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  appendLog(entry: string): void {
    this.logEntries.push(entry);
  }

  logs(): readonly string[] {
    return this.logEntries;
  }

  snapshot(): Record<string, ContextValue> {
    const result: Record<string, ContextValue> = {};
    for (const [key, value] of this.values) {
      result[key] = value;
    }
    return result;
  }

  clone(): Context {
    const ctx = new Context();
    for (const [key, value] of this.values) {
      ctx.values.set(key, value);
    }
    ctx.logEntries = [...this.logEntries];
    return ctx;
  }

  applyUpdates(updates: Record<string, ContextValue>): void {
    for (const [key, value] of Object.entries(updates)) {
      this.values.set(key, value);
    }
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  size(): number {
    return this.values.size;
  }
}
