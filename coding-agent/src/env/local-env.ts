import { mkdir, readdir, readFile as fsReadFile, stat } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { release } from "node:os";
import { join, resolve, dirname, relative } from "node:path";
import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../types/index.js";
import { filterEnvironmentVariables, type EnvVarPolicy } from "./env-filter.js";

export interface LocalEnvOptions {
  workingDir: string;
  envVarPolicy?: EnvVarPolicy;
}

function isLikelyBinaryContent(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }

  const sampleSize = Math.min(bytes.length, 4096);
  let controlCount = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = bytes[i];
    if (byte === 0) {
      return true;
    }
    // Allow common printable/whitespace bytes; flag other control bytes.
    if ((byte < 9 || (byte > 13 && byte < 32) || byte === 127)) {
      controlCount++;
    }
  }

  return controlCount / sampleSize > 0.3;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private readonly workingDir: string;
  private readonly envVarPolicy: EnvVarPolicy;

  constructor(options: LocalEnvOptions) {
    this.workingDir = options.workingDir;
    this.envVarPolicy = options.envVarPolicy ?? "exclude_sensitive";
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

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isLikelyBinaryContent(bytes)) {
      throw new Error(`Binary file: ${resolvedPath}`);
    }
    const text = Buffer.from(bytes).toString("utf-8");
    const allLines = text.split("\n");

    // offset is 1-based
    const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const lines =
      limit !== undefined
        ? allLines.slice(startLine, startLine + limit)
        : allLines.slice(startLine);

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
    abortSignal?: AbortSignal,
  ): Promise<ExecResult> {
    const cwd = workingDir ? this.resolvePath(workingDir) : this.workingDir;
    const filteredEnv = filterEnvironmentVariables(process.env, this.envVarPolicy);
    const env = envVars ? { ...filteredEnv, ...envVars } : filteredEnv;

    const startTime = Date.now();
    let timedOut = false;

    // Use node:child_process with detached to create a process group,
    // so we can kill the entire tree on timeout (not just the shell).
    const isWindows = process.platform === "win32";
    const shellCmd = isWindows ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWindows ? ["/c", command] : ["-c", command];

    const proc = nodeSpawn(shellCmd, shellArgs, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: !isWindows,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    const killProcessGroup = (signal: NodeJS.Signals): void => {
      try {
        if (isWindows) {
          // Windows: kill the process directly (no process groups)
          proc.kill(signal);
        } else {
          // Unix: negative PID kills the entire process group
          if (proc.pid !== undefined) {
            process.kill(-proc.pid, signal);
          }
        }
      } catch {
        // Process may already be dead
      }
    };

    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let abortForceKillTimer: ReturnType<typeof setTimeout> | undefined;

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

    // Listen for abort signal to kill the process early
    const abortPromise = new Promise<void>((resolvePromise) => {
      if (!abortSignal) return; // never resolves — timeout or exit will win
      if (abortSignal.aborted) {
        killProcessGroup("SIGTERM");
        abortForceKillTimer = setTimeout(() => killProcessGroup("SIGKILL"), 2000);
        resolvePromise();
        return;
      }
      abortSignal.addEventListener("abort", () => {
        killProcessGroup("SIGTERM");
        abortForceKillTimer = setTimeout(() => killProcessGroup("SIGKILL"), 2000);
        resolvePromise();
      }, { once: true });
    });

    // Wait for exit, timeout, or abort
    const exitCode = await Promise.race([
      exitPromise,
      timeoutPromise.then(() => null),
      abortPromise.then(() => null),
    ]);

    // If timed out or aborted, wait for process to actually exit (bounded by SIGKILL 2s + buffer)
    if (timedOut || abortSignal?.aborted) {
      await Promise.race([
        exitPromise,
        new Promise<void>((r) => setTimeout(r, 3000)),
      ]);
    }

    if (killTimer !== undefined) clearTimeout(killTimer);
    if (forceKillTimer !== undefined) clearTimeout(forceKillTimer);
    if (abortForceKillTimer !== undefined) clearTimeout(abortForceKillTimer);

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

    const rgResult = await this.grepWithRipgrep(pattern, resolvedPath, options);
    if (rgResult !== null) {
      return rgResult;
    }

    return this.grepNative(pattern, resolvedPath, options);
  }

  private async grepWithRipgrep(
    pattern: string,
    resolvedPath: string,
    options?: GrepOptions,
  ): Promise<string | null> {
    const mode = options?.outputMode ?? "content";
    const modeFlag =
      mode === "files_with_matches" ? "--files-with-matches" :
      mode === "count" ? "--count" :
      "--line-number";
    const args = ["rg", modeFlag];

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

    // Exit code 127 means command not found; also check stderr for common not-found messages
    if (result.exitCode === 127 || result.stderr.includes("not found")) {
      return null;
    }

    return result.stdout;
  }

  private async grepNative(
    pattern: string,
    resolvedPath: string,
    options?: GrepOptions,
  ): Promise<string> {
    const flags = options?.caseInsensitive ? "i" : "";
    const regex = new RegExp(pattern, flags);
    const mode = options?.outputMode ?? "content";
    const maxResults = options?.maxResults;
    const globFilter = options?.globFilter;

    const filePaths = await this.collectFiles(resolvedPath, globFilter);
    const outputLines: string[] = [];

    for (const filePath of filePaths) {
      if (maxResults !== undefined && outputLines.length >= maxResults) break;

      let content: string;
      try {
        content = await fsReadFile(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      let fileMatchCount = 0;

      for (let i = 0; i < lines.length; i++) {
        if (maxResults !== undefined && outputLines.length >= maxResults) break;

        const line = lines[i];
        if (line !== undefined && regex.test(line)) {
          fileMatchCount++;
          const relPath = relative(resolvedPath, filePath);

          if (mode === "content") {
            outputLines.push(`${relPath}:${i + 1}:${line}`);
          } else if (mode === "files_with_matches") {
            outputLines.push(relPath);
            break; // only need one match per file for this mode
          }
        }
      }

      if (mode === "count" && fileMatchCount > 0) {
        const relPath = relative(resolvedPath, filePath);
        outputLines.push(`${relPath}:${fileMatchCount}`);
      }
    }

    return outputLines.join("\n") + (outputLines.length > 0 ? "\n" : "");
  }

  private async collectFiles(dir: string, globFilter?: string): Promise<string[]> {
    const results: string[] = [];
    const globMatcher = globFilter ? new Bun.Glob(globFilter) : null;

    async function walk(currentDir: string): Promise<void> {
      let entries: string[];
      try {
        entries = await readdir(currentDir);
      } catch {
        return;
      }
      for (const name of entries) {
        const fullPath = join(currentDir, name);
        let stats;
        try {
          stats = await stat(fullPath);
        } catch {
          continue;
        }
        if (stats.isDirectory()) {
          await walk(fullPath);
        } else if (stats.isFile()) {
          if (globMatcher) {
            const relPath = relative(dir, fullPath);
            if (!globMatcher.match(relPath)) continue;
          }
          results.push(fullPath);
        }
      }
    }

    // resolvedPath could be a file, not a directory
    let pathStat;
    try {
      pathStat = await stat(dir);
    } catch {
      return results;
    }

    if (pathStat.isFile()) {
      results.push(dir);
    } else {
      await walk(dir);
    }

    return results;
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
