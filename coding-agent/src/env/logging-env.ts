import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/execution-env.js";

export interface LogEntry {
  method: string;
  args: unknown[];
  durationMs: number;
  error?: Error;
}

export class LoggingExecutionEnvironment implements ExecutionEnvironment {
  private readonly inner: ExecutionEnvironment;
  private readonly logger: (entry: LogEntry) => void;

  constructor(inner: ExecutionEnvironment, logger: (entry: LogEntry) => void) {
    this.inner = inner;
    this.logger = logger;
  }

  private async wrap<T>(method: string, args: unknown[], fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.logger({ method, args, durationMs: Date.now() - start });
      return result;
    } catch (thrown: unknown) {
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      this.logger({ method, args, durationMs: Date.now() - start, error });
      throw thrown;
    }
  }

  readFile(path: string, offset?: number, limit?: number): Promise<string> {
    return this.wrap("readFile", [path, offset, limit], () =>
      this.inner.readFile(path, offset, limit),
    );
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.wrap("writeFile", [path, content], () =>
      this.inner.writeFile(path, content),
    );
  }

  fileExists(path: string): Promise<boolean> {
    return this.wrap("fileExists", [path], () =>
      this.inner.fileExists(path),
    );
  }

  listDirectory(path: string, depth?: number): Promise<DirEntry[]> {
    return this.wrap("listDirectory", [path, depth], () =>
      this.inner.listDirectory(path, depth),
    );
  }

  execCommand(
    command: string,
    timeoutMs: number,
    workingDir?: string,
    envVars?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<ExecResult> {
    return this.wrap("execCommand", [command, timeoutMs, workingDir], () =>
      this.inner.execCommand(command, timeoutMs, workingDir, envVars, abortSignal),
    );
  }

  grep(pattern: string, path: string, options?: GrepOptions): Promise<string> {
    return this.wrap("grep", [pattern, path, options], () =>
      this.inner.grep(pattern, path, options),
    );
  }

  glob(pattern: string, path?: string): Promise<string[]> {
    return this.wrap("glob", [pattern, path], () =>
      this.inner.glob(pattern, path),
    );
  }

  initialize(): Promise<void> {
    return this.wrap("initialize", [], () =>
      this.inner.initialize(),
    );
  }

  cleanup(): Promise<void> {
    return this.wrap("cleanup", [], () =>
      this.inner.cleanup(),
    );
  }

  workingDirectory(): string {
    return this.inner.workingDirectory();
  }

  platform(): string {
    return this.inner.platform();
  }

  osVersion(): string {
    return this.inner.osVersion();
  }
}
