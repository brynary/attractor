import { isAbsolute, resolve } from "node:path";
import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/index.js";

function resolveScopedPath(path: string, scopedWorkingDir: string): string {
  return isAbsolute(path) ? path : resolve(scopedWorkingDir, path);
}

/**
 * Wraps an execution environment with a different working directory scope.
 * Absolute paths are preserved; relative paths are resolved against scoped cwd.
 */
export class ScopedExecutionEnvironment implements ExecutionEnvironment {
  private readonly inner: ExecutionEnvironment;
  private readonly scopedWorkingDir: string;

  constructor(inner: ExecutionEnvironment, scopedWorkingDir: string) {
    this.inner = inner;
    this.scopedWorkingDir = scopedWorkingDir;
  }

  readFile(path: string, offset?: number, limit?: number): Promise<string> {
    return this.inner.readFile(
      resolveScopedPath(path, this.scopedWorkingDir),
      offset,
      limit,
    );
  }

  writeFile(path: string, content: string): Promise<void> {
    return this.inner.writeFile(resolveScopedPath(path, this.scopedWorkingDir), content);
  }

  fileExists(path: string): Promise<boolean> {
    return this.inner.fileExists(resolveScopedPath(path, this.scopedWorkingDir));
  }

  listDirectory(path: string, depth?: number): Promise<DirEntry[]> {
    return this.inner.listDirectory(resolveScopedPath(path, this.scopedWorkingDir), depth);
  }

  execCommand(
    command: string,
    timeoutMs: number,
    workingDir?: string,
    envVars?: Record<string, string>,
    abortSignal?: AbortSignal,
  ): Promise<ExecResult> {
    const effectiveDir = workingDir
      ? resolveScopedPath(workingDir, this.scopedWorkingDir)
      : this.scopedWorkingDir;
    return this.inner.execCommand(
      command,
      timeoutMs,
      effectiveDir,
      envVars,
      abortSignal,
    );
  }

  grep(pattern: string, path: string, options?: GrepOptions): Promise<string> {
    return this.inner.grep(pattern, resolveScopedPath(path, this.scopedWorkingDir), options);
  }

  glob(pattern: string, path?: string): Promise<string[]> {
    const effectivePath = path
      ? resolveScopedPath(path, this.scopedWorkingDir)
      : this.scopedWorkingDir;
    return this.inner.glob(pattern, effectivePath);
  }

  initialize(): Promise<void> {
    return this.inner.initialize();
  }

  cleanup(): Promise<void> {
    return this.inner.cleanup();
  }

  workingDirectory(): string {
    return this.scopedWorkingDir;
  }

  platform(): string {
    return this.inner.platform();
  }

  osVersion(): string {
    return this.inner.osVersion();
  }
}

export function scopeExecutionEnvironment(
  inner: ExecutionEnvironment,
  workingDir: string,
): ExecutionEnvironment {
  const scopedWorkingDir = resolve(inner.workingDirectory(), workingDir);
  return new ScopedExecutionEnvironment(inner, scopedWorkingDir);
}
