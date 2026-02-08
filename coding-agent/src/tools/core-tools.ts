import type { RegisteredTool } from "../types/index.js";
import type { ExecutionEnvironment } from "../types/index.js";
import { normalizeForFuzzyMatch } from "./apply-patch.js";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico",
]);

const MAX_IMAGE_SIZE = 1_000_000; // 1 MB

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot < 0) return "";
  return filePath.slice(lastDot).toLowerCase();
}

function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

function isWindowsPlatform(platform: string): boolean {
  return platform === "win32" || platform === "windows";
}

function powershellEscapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function imageSizeCommand(filePath: string, platform: string): string {
  if (isWindowsPlatform(platform)) {
    return `powershell -NoProfile -Command "(Get-Item -LiteralPath '${powershellEscapeLiteral(filePath)}').Length"`;
  }
  return `wc -c < '${filePath.replace(/'/g, "'\\''")}'`;
}

function imageBase64Command(filePath: string, platform: string): string {
  if (isWindowsPlatform(platform)) {
    return `powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('${powershellEscapeLiteral(filePath)}'))"`;
  }
  return `base64 < '${filePath.replace(/'/g, "'\\''")}'`;
}

/**
 * Strip line-number prefixes produced by env.readFile().
 * Format is "  N | content" — we strip everything up to and including " | ".
 */
function stripLineNumbers(numbered: string): string {
  return numbered
    .split("\n")
    .map((line) => {
      const pipeIndex = line.indexOf(" | ");
      return pipeIndex >= 0 ? line.slice(pipeIndex + 3) : line;
    })
    .join("\n");
}

export function createReadFileTool(): RegisteredTool {
  return {
    definition: {
      name: "read_file",
      description:
        "Read a file from the filesystem. Returns line-numbered content.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to read" },
          offset: { type: "integer", description: "1-based line number to start reading from" },
          limit: {
            type: "integer",
            description: "Maximum number of lines to read",
            default: 2000,
          },
        },
        required: ["file_path"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;

      if (isImageFile(filePath)) {
        const exists = await env.fileExists(filePath);
        if (!exists) {
          throw new Error(`File not found: ${filePath}`);
        }

        const platform = env.platform();
        // Use shell to get file size
        const sizeResult = await env.execCommand(imageSizeCommand(filePath, platform), 5000);
        const fileSize = parseInt(sizeResult.stdout.trim(), 10);

        if (isNaN(fileSize) || fileSize > MAX_IMAGE_SIZE) {
          const sizeDesc = isNaN(fileSize) ? "unknown size" : `${fileSize} bytes`;
          return `[Image file: ${filePath} (${sizeDesc}). Use the shell tool to process this image if needed.]`;
        }

        // Read as base64
        const b64Result = await env.execCommand(imageBase64Command(filePath, platform), 5000);
        const base64Data = b64Result.stdout.replace(/\s/g, "");
        const ext = getExtension(filePath);
        const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";

        return `data:${mimeType};base64,${base64Data}`;
      }

      return env.readFile(filePath, offset, limit);
    },
  };
}

export function createWriteFileTool(): RegisteredTool {
  return {
    definition: {
      name: "write_file",
      description:
        "Write content to a file. Creates the file and parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to write" },
          content: { type: "string", description: "Content to write to the file" },
        },
        required: ["file_path", "content"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const content = args.content as string;
      await env.writeFile(filePath, content);
      return `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${filePath}`;
    },
  };
}

export function createEditFileTool(): RegisteredTool {
  return {
    definition: {
      name: "edit_file",
      description: "Replace an exact string occurrence in a file.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute path to the file to edit" },
          old_string: { type: "string", description: "The exact string to find and replace" },
          new_string: { type: "string", description: "The replacement string" },
          replace_all: {
            type: "boolean",
            description: "Replace all occurrences instead of just the first",
            default: false,
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const oldString = args.old_string as string;
      const newString = args.new_string as string;
      const replaceAll = (args.replace_all as boolean | undefined) ?? false;

      const numbered = await env.readFile(filePath);
      const rawContent = stripLineNumbers(numbered);

      if (rawContent.includes(oldString)) {
        const occurrences = rawContent.split(oldString).length - 1;

        if (!replaceAll && occurrences > 1) {
          throw new Error(
            `old_string is not unique in ${filePath}. Provide more context or use replace_all.`,
          );
        }

        const newContent = replaceAll
          ? rawContent.replaceAll(oldString, newString)
          : rawContent.replace(oldString, newString);

        await env.writeFile(filePath, newContent);

        const replaced = replaceAll ? occurrences : 1;
        return `Replaced ${replaced} occurrence(s) in ${filePath}`;
      }

      // Fuzzy match fallback: normalize whitespace and retry
      const normalizedContent = rawContent.split("\n").map(normalizeForFuzzyMatch).join("\n");
      const normalizedOld = oldString.split("\n").map(normalizeForFuzzyMatch).join("\n");

      if (!normalizedContent.includes(normalizedOld)) {
        throw new Error(`old_string not found in ${filePath}`);
      }

      // Find all fuzzy match positions in the normalized content
      const originalLines = rawContent.split("\n");
      let newContent = rawContent;
      let replacedCount = 0;
      let searchFrom = 0;

      while (true) {
        const normalizedPos = normalizedContent.indexOf(normalizedOld, searchFrom);
        if (normalizedPos < 0) break;

        const normalizedLines = normalizedContent.slice(0, normalizedPos).split("\n");
        const startLine = normalizedLines.length - 1;
        const oldLines = normalizedOld.split("\n");
        const endLine = startLine + oldLines.length;
        const matchedOriginal = originalLines.slice(startLine, endLine).join("\n");

        newContent = newContent.replace(matchedOriginal, newString);
        replacedCount++;

        if (!replaceAll) break;

        searchFrom = normalizedPos + normalizedOld.length;
      }

      await env.writeFile(filePath, newContent);
      return `Replaced ${replacedCount} occurrence(s) in ${filePath} (fuzzy match)`;
    },
  };
}

export function createShellTool(config?: {
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
}): RegisteredTool {
  const defaultTimeoutMs = config?.defaultTimeoutMs ?? 10_000;
  const maxTimeoutMs = config?.maxTimeoutMs ?? 600_000;
  return {
    definition: {
      name: "shell",
      description: "Execute a shell command. Returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
          timeout_ms: {
            type: "integer",
            description: "Timeout in milliseconds",
          },
          description: {
            type: "string",
            description: "Description of what this command does",
          },
        },
        required: ["command"],
      },
    },
    executor: async (args, env, signal) => {
      const command = args.command as string;
      const requestedTimeout = args.timeout_ms as number | undefined;
      const timeout = Math.min(
        requestedTimeout ?? defaultTimeoutMs,
        maxTimeoutMs,
      );

      if (signal?.aborted) {
        return "[ERROR: Command aborted before execution.]";
      }

      const result = await env.execCommand(command, timeout, undefined, undefined, signal);

      const parts: string[] = [];
      if (result.stdout) {
        parts.push(result.stdout);
      }
      if (result.stderr) {
        parts.push(`[stderr]\n${result.stderr}`);
      }
      parts.push(`[exit code: ${result.exitCode}] [duration: ${result.durationMs}ms]`);

      if (result.timedOut) {
        parts.push(
          `[ERROR: Command timed out after ${timeout}ms. Partial output is shown above.\nYou can retry with a longer timeout by setting the timeout_ms parameter.]`,
        );
      }

      return parts.join("\n");
    },
  };
}

export function createGrepTool(): RegisteredTool {
  return {
    definition: {
      name: "grep",
      description: "Search file contents using regex patterns.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory or file to search in" },
          glob_filter: { type: "string", description: "Glob pattern to filter files" },
          case_insensitive: { type: "boolean", description: "Case insensitive search" },
          max_results: {
            type: "integer",
            description: "Maximum number of results",
            default: 100,
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: "Output mode: content (matching lines), files_with_matches (file paths only), count (match counts per file)",
            default: "content",
          },
        },
        required: ["pattern"],
      },
    },
    executor: async (args, env) => {
      const pattern = args.pattern as string;
      const path = (args.path as string | undefined) ?? env.workingDirectory();
      const globFilter = args.glob_filter as string | undefined;
      const caseInsensitive = args.case_insensitive as boolean | undefined;
      const maxResults = args.max_results as number | undefined;
      const outputMode = args.output_mode as "content" | "files_with_matches" | "count" | undefined;

      return env.grep(pattern, path, {
        caseInsensitive,
        globFilter,
        maxResults: maxResults ?? 100,
        outputMode,
      });
    },
  };
}

export function createGlobTool(): RegisteredTool {
  return {
    definition: {
      name: "glob",
      description: "Find files matching a glob pattern, sorted by modification time (newest first).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern to match files" },
          path: { type: "string", description: "Base directory to search in" },
        },
        required: ["pattern"],
      },
    },
    executor: async (args, env) => {
      const pattern = args.pattern as string;
      const path = args.path as string | undefined;
      const files = await env.glob(pattern, path);
      return files.join("\n");
    },
  };
}
