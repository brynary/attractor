export class Context {
  private values: Map<string, string>;
  private logEntries: string[];

  constructor() {
    this.values = new Map();
    this.logEntries = [];
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  get(key: string, defaultValue: string = ""): string {
    return this.values.get(key) ?? defaultValue;
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

  snapshot(): Record<string, string> {
    const result: Record<string, string> = {};
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

  applyUpdates(updates: Record<string, string>): void {
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
