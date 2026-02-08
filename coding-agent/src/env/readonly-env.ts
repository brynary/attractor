import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/execution-env.js";

export class ReadOnlyExecutionEnvironment implements ExecutionEnvironment {
  private readonly inner: ExecutionEnvironment;

  constructor(inner: ExecutionEnvironment) {
    this.inner = inner;
  }

  readFile(path: string, offset?: number, limit?: number): Promise<string> {
    return this.inner.readFile(path, offset, limit);
  }

  async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error("Write operations are disabled in read-only mode");
  }

  fileExists(path: string): Promise<boolean> {
    return this.inner.fileExists(path);
  }

  listDirectory(path: string, depth?: number): Promise<DirEntry[]> {
    return this.inner.listDirectory(path, depth);
  }

  async execCommand(
    _command: string,
    _timeoutMs: number,
    _workingDir?: string,
    _envVars?: Record<string, string>,
    _abortSignal?: AbortSignal,
  ): Promise<ExecResult> {
    throw new Error("Write operations are disabled in read-only mode");
  }

  grep(pattern: string, path: string, options?: GrepOptions): Promise<string> {
    return this.inner.grep(pattern, path, options);
  }

  glob(pattern: string, path?: string): Promise<string[]> {
    return this.inner.glob(pattern, path);
  }

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  cleanup(): Promise<void> {
    return this.inner.cleanup();
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
