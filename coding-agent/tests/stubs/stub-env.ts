import type {
  ExecutionEnvironment,
  ExecResult,
  DirEntry,
  GrepOptions,
} from "../../src/types/execution-env.js";

const DEFAULT_EXEC_RESULT: ExecResult = {
  stdout: "",
  stderr: "",
  exitCode: 0,
  timedOut: false,
  durationMs: 0,
};

export class StubExecutionEnvironment implements ExecutionEnvironment {
  private files = new Map<string, string>();
  private commandResults: Map<string, ExecResult>;
  private defaultExecResult: ExecResult;

  constructor(options?: {
    files?: Map<string, string>;
    commandResults?: Map<string, ExecResult>;
    defaultExecResult?: ExecResult;
  }) {
    this.files = new Map(options?.files ?? []);
    this.commandResults = new Map(options?.commandResults ?? []);
    this.defaultExecResult = options?.defaultExecResult ?? DEFAULT_EXEC_RESULT;
  }

  async readFile(path: string, offset?: number, limit?: number): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    const lines = content.split("\n");
    const startLine = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const endLine = limit !== undefined ? startLine + limit : lines.length;
    const sliced = lines.slice(startLine, endLine);
    return sliced
      .map((line, i) => {
        const lineNum = String(startLine + i + 1).padStart(3, " ");
        return `${lineNum} | ${line}`;
      })
      .join("\n");
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async fileExists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async listDirectory(path: string, _depth?: number): Promise<DirEntry[]> {
    const prefix = path.endsWith("/") ? path : path + "/";
    const seen = new Set<string>();
    const entries: DirEntry[] = [];

    for (const [filePath, content] of this.files) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const firstSegment = rest.split("/")[0];
      if (firstSegment === undefined || seen.has(firstSegment)) continue;
      seen.add(firstSegment);

      const isDir = rest.includes("/");
      entries.push({
        name: firstSegment,
        isDir,
        size: isDir ? null : content.length,
      });
    }

    return entries;
  }

  async execCommand(
    command: string,
    _timeoutMs: number,
    _workingDir?: string,
    _envVars?: Record<string, string>,
    _abortSignal?: AbortSignal,
  ): Promise<ExecResult> {
    return this.commandResults.get(command) ?? this.defaultExecResult;
  }

  async grep(
    pattern: string,
    path: string,
    options?: GrepOptions,
  ): Promise<string> {
    const flags = options?.caseInsensitive ? "i" : "";
    const regex = new RegExp(pattern, flags);
    const mode = options?.outputMode ?? "content";
    const maxResults = options?.maxResults ?? Infinity;
    const matches: string[] = [];
    const fileCounts = new Map<string, number>();

    for (const [filePath, content] of this.files) {
      if (!filePath.startsWith(path)) continue;
      if (options?.globFilter) {
        const globSuffix = options.globFilter.replace(/^\*/, "");
        if (!filePath.endsWith(globSuffix)) continue;
      }
      const lines = content.split("\n");
      let fileMatchCount = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && regex.test(line)) {
          fileMatchCount++;
          if (mode === "content") {
            matches.push(`${filePath}:${i + 1}:${line}`);
            if (matches.length >= maxResults) return matches.join("\n");
          }
          if (mode === "files_with_matches") {
            matches.push(filePath);
            break; // one entry per file
          }
        }
      }
      if (mode === "count" && fileMatchCount > 0) {
        fileCounts.set(filePath, fileMatchCount);
      }
    }

    if (mode === "count") {
      const countLines: string[] = [];
      for (const [filePath, count] of fileCounts) {
        countLines.push(`${filePath}:${count}`);
      }
      return countLines.join("\n");
    }

    return matches.join("\n");
  }

  async glob(pattern: string, path?: string): Promise<string[]> {
    const prefix = path ?? "";
    const regexStr = pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "<<GLOBSTAR>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<GLOBSTAR>>/g, ".*");
    const regex = new RegExp(`^${regexStr}$`);

    const results: string[] = [];
    for (const filePath of this.files.keys()) {
      const testPath = prefix ? filePath.slice(prefix.length) : filePath;
      if (regex.test(testPath) || regex.test(filePath)) {
        results.push(filePath);
      }
    }
    return results;
  }

  async initialize(): Promise<void> {}

  async cleanup(): Promise<void> {}

  workingDirectory(): string {
    return "/test";
  }

  platform(): string {
    return "darwin";
  }

  osVersion(): string {
    return "Test 1.0";
  }
}
