import { mkdir, readdir, stat } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { release } from "node:os";
import { join, resolve, dirname } from "node:path";
import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/index.js";
import { filterEnvironmentVariables } from "./env-filter.js";

export interface LocalEnvOptions {
  workingDir: string;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private readonly workingDir: string;

  constructor(options: LocalEnvOptions) {
    this.workingDir = options.workingDir;
  }

  private resolvePath(path: string): string {
    return resolve(this.workingDir, path);
  }

  async readFile(path: string, offset?: number, limit?: number): Promise<string> {
    const resolvedPath = this.resolvePath(path);
    const file = Bun.file(resolvedPath);

    if (!(await file.exists())) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const text = await file.text();
    const allLines = text.split("\n");

    // offset is 1-based
    const startLine = offset !== undefined ? offset - 1 : 0;
    const lineLimit = limit ?? 2000;
    const lines = allLines.slice(startLine, startLine + lineLimit);

    const lastLineNumber = startLine + lines.length;
    const padWidth = String(lastLineNumber).length;

    const formatted = lines.map((content, i) => {
      const lineNumber = String(startLine + i + 1).padStart(padWidth, " ");
      return `${lineNumber} | ${content}`;
    });

    return formatted.join("\n");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolvedPath = this.resolvePath(path);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await Bun.write(resolvedPath, content);
  }

  async fileExists(path: string): Promise<boolean> {
    const resolvedPath = this.resolvePath(path);
    return Bun.file(resolvedPath).exists();
  }

  async listDirectory(path: string, depth?: number): Promise<DirEntry[]> {
    const resolvedPath = this.resolvePath(path);
    const effectiveDepth = depth ?? 1;
    const entries: DirEntry[] = [];

    async function walk(dir: string, currentDepth: number): Promise<void> {
      if (currentDepth > effectiveDepth) return;

      const dirEntries = await readdir(dir);
      for (const name of dirEntries) {
        const fullPath = join(dir, name);
        const stats = await stat(fullPath);
        entries.push({
          name: currentDepth === 1 ? name : join(dir.slice(resolvedPath.length + 1), name),
          isDir: stats.isDirectory(),
          size: stats.isDirectory() ? null : stats.size,
        });

        if (stats.isDirectory() && currentDepth < effectiveDepth) {
          await walk(fullPath, currentDepth + 1);
        }
      }
    }

    await walk(resolvedPath, 1);
    return entries;
  }

  async execCommand(
    command: string,
    timeoutMs: number,
    workingDir?: string,
    envVars?: Record<string, string>,
  ): Promise<ExecResult> {
    const cwd = workingDir ? this.resolvePath(workingDir) : this.workingDir;
    const filteredEnv = filterEnvironmentVariables(process.env);
    const env = envVars ? { ...filteredEnv, ...envVars } : filteredEnv;

    const startTime = Date.now();
    let timedOut = false;

    // Use node:child_process with detached to create a process group,
    // so we can kill the entire tree on timeout (not just the shell).
    const proc = nodeSpawn("bash", ["-c", command], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      try {
        // Negative PID kills the entire process group
        process.kill(-proc.pid!, signal);
      } catch {
        // Process group may already be dead
      }
    };

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

    const exitPromise = new Promise<number | null>((resolveExit) => {
      proc.on("close", (code) => resolveExit(code));
      proc.on("error", () => resolveExit(null));
    });

    const timeoutPromise = new Promise<void>((resolvePromise) => {
      killTimer = setTimeout(() => {
        timedOut = true;
        killProcessGroup("SIGTERM");
        // Force kill after 2 seconds if still alive
        forceKillTimer = setTimeout(() => {
          killProcessGroup("SIGKILL");
        }, 2000);
        resolvePromise();
      }, timeoutMs);
    });

    // Wait for exit or timeout
    const exitCode = await Promise.race([
      exitPromise,
      timeoutPromise.then(() => null),
    ]);

    if (killTimer !== undefined) clearTimeout(killTimer);
    if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);

    // If timed out, wait briefly for streams to flush
    if (timedOut) {
      await new Promise<void>((r) => setTimeout(r, 100));
    }

    const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
    const stderr = Buffer.concat(stderrChunks).toString("utf-8");
    const durationMs = Date.now() - startTime;

    return { stdout, stderr, exitCode: exitCode ?? 1, timedOut, durationMs };
  }

  async grep(
    pattern: string,
    path: string,
    options?: GrepOptions,
  ): Promise<string> {
    const resolvedPath = this.resolvePath(path);
    const args = ["rg", "--line-number"];

    if (options?.caseInsensitive) {
      args.push("--ignore-case");
    }
    if (options?.globFilter) {
      args.push("--glob", options.globFilter);
    }
    if (options?.maxResults !== undefined) {
      args.push("--max-count", String(options.maxResults));
    }

    args.push(pattern, resolvedPath);
    const command = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");

    const result = await this.execCommand(command, 30_000);
    return result.stdout;
  }

  async glob(pattern: string, path?: string): Promise<string[]> {
    const basePath = path ? this.resolvePath(path) : this.workingDir;
    const globber = new Bun.Glob(pattern);
    const results: Array<{ path: string; mtime: number }> = [];

    for await (const entry of globber.scan({ cwd: basePath, dot: false })) {
      const fullPath = join(basePath, entry);
      try {
        const stats = await stat(fullPath);
        results.push({ path: entry, mtime: stats.mtimeMs });
      } catch {
        // File may have been deleted between scan and stat
        results.push({ path: entry, mtime: 0 });
      }
    }

    results.sort((a, b) => b.mtime - a.mtime);
    return results.map((r) => r.path);
  }

  workingDirectory(): string {
    return this.workingDir;
  }

  platform(): string {
    return process.platform;
  }

  osVersion(): string {
    return release();
  }

  async initialize(): Promise<void> {
    // no-op
  }

  async cleanup(): Promise<void> {
    // no-op
  }
}
