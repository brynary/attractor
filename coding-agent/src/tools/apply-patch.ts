import type { RegisteredTool, ExecutionEnvironment } from "../types/index.js";

/**
 * Normalize a line for fuzzy matching: collapse whitespace, normalize Unicode
 * punctuation (smart quotes, dashes, non-breaking spaces, ellipsis) to their
 * ASCII equivalents, and trim trailing whitespace.
 */
export function normalizeForFuzzyMatch(line: string): string {
  return line
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u2026/g, "...")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+$/, "");
}

export interface PatchOperation {
  kind: "add" | "delete" | "update";
  path: string;
  newPath?: string;
  content?: string;
  hunks?: Hunk[];
}

export interface Hunk {
  contextHint: string;
  lines: HunkLine[];
}

export interface HunkLine {
  kind: "context" | "add" | "delete";
  content: string;
}

export function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.split("\n");
  let i = 0;
  let sawEndPatch = false;

  // Find "*** Begin Patch"
  while (i < lines.length && lines[i]?.trim() !== "*** Begin Patch") {
    i++;
  }
  if (i >= lines.length) {
    throw new Error("Invalid patch: missing '*** Begin Patch'");
  }
  i++; // skip Begin Patch line

  const operations: PatchOperation[] = [];

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "*** End Patch") {
      sawEndPatch = true;
      break;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length) {
        const cl = lines[i] ?? "";
        if (cl.startsWith("*** ") || cl.startsWith("@@ ")) break;
        if (cl.startsWith("+")) {
          contentLines.push(cl.slice(1));
        }
        i++;
      }
      operations.push({ kind: "add", path, content: contentLines.join("\n") });
    } else if (line.startsWith("*** Delete File: ")) {
      const path = line.slice("*** Delete File: ".length).trim();
      operations.push({ kind: "delete", path });
      i++;
    } else if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim();
      i++;

      let newPath: string | undefined;
      if (i < lines.length && (lines[i] ?? "").startsWith("*** Move to: ")) {
        newPath = (lines[i] ?? "").slice("*** Move to: ".length).trim();
        i++;
      }

      const hunks: Hunk[] = [];
      while (i < lines.length) {
        const hl = lines[i] ?? "";
        if (hl.startsWith("*** ")) break;
        if (hl.startsWith("@@ ")) {
          const contextHint = hl.slice(3).trim();
          i++;
          const hunkLines: HunkLine[] = [];
          while (i < lines.length) {
            const hunkLine = lines[i] ?? "";
            if (hunkLine === "*** End of File") {
              i++;
              continue;
            }
            if (hunkLine.startsWith("@@ ") || hunkLine.startsWith("*** ")) break;
            if (hunkLine.startsWith("+")) {
              hunkLines.push({ kind: "add", content: hunkLine.slice(1) });
            } else if (hunkLine.startsWith("-")) {
              hunkLines.push({ kind: "delete", content: hunkLine.slice(1) });
            } else if (hunkLine.startsWith(" ")) {
              hunkLines.push({ kind: "context", content: hunkLine.slice(1) });
            }
            i++;
          }
          hunks.push({ contextHint, lines: hunkLines });
        } else {
          i++;
        }
      }

      const op: PatchOperation = { kind: "update", path, hunks };
      if (newPath !== undefined) {
        op.newPath = newPath;
      }
      operations.push(op);
    } else {
      i++;
    }
  }

  if (!sawEndPatch) {
    throw new Error("Invalid patch: missing '*** End Patch'");
  }

  return operations;
}

/**
 * Strip line-number prefixes from env.readFile() output.
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

export function applyHunks(content: string, hunks: Hunk[]): string {
  const fileLines = content.split("\n");

  // Apply hunks in order, tracking offset shifts
  let offset = 0;

  for (const hunk of hunks) {
    // Collect context and delete lines to form the "search pattern"
    const searchLines: string[] = [];
    for (const hl of hunk.lines) {
      if (hl.kind === "context" || hl.kind === "delete") {
        searchLines.push(hl.content);
      }
    }

    // Find the location in the file
    let matchStart = -1;
    for (let j = offset; j <= fileLines.length - searchLines.length; j++) {
      let matches = true;
      for (let k = 0; k < searchLines.length; k++) {
        if (fileLines[j + k] !== searchLines[k]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchStart = j;
        break;
      }
    }

    // Fuzzy match fallback: normalize whitespace and retry
    if (matchStart === -1) {
      const normalizedSearch = searchLines.map(normalizeForFuzzyMatch);
      for (let j = offset; j <= fileLines.length - searchLines.length; j++) {
        let matches = true;
        for (let k = 0; k < normalizedSearch.length; k++) {
          if (normalizeForFuzzyMatch(fileLines[j + k] ?? "") !== normalizedSearch[k]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          matchStart = j;
          break;
        }
      }
    }

    if (matchStart === -1) {
      throw new Error(
        `Could not find hunk location even after fuzzy matching for context hint: "${hunk.contextHint}"`,
      );
    }

    // Build replacement lines
    const replacementLines: string[] = [];
    for (const hl of hunk.lines) {
      if (hl.kind === "context") {
        replacementLines.push(hl.content);
      } else if (hl.kind === "add") {
        replacementLines.push(hl.content);
      }
      // delete lines are omitted
    }

    // Splice the replacement in
    fileLines.splice(matchStart, searchLines.length, ...replacementLines);

    // Update offset to after the replacement
    offset = matchStart + replacementLines.length;
  }

  return fileLines.join("\n");
}

/**
 * Escape a path for safe use inside single-quoted shell arguments.
 */
function shellEscapePath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

function powershellEscapePath(path: string): string {
  return path.replace(/'/g, "''");
}

function deleteCommandForPath(path: string, platform: string): string {
  if (platform === "win32" || platform === "windows") {
    return `powershell -NoProfile -Command "Remove-Item -LiteralPath '${powershellEscapePath(path)}' -Force -Recurse"`;
  }
  return `rm -- ${shellEscapePath(path)}`;
}

export async function applyPatch(
  patch: string,
  env: ExecutionEnvironment,
): Promise<string> {
  const operations = parsePatch(patch);
  const summaries: string[] = [];

  for (const op of operations) {
    switch (op.kind) {
      case "add": {
        await env.writeFile(op.path, op.content ?? "");
        summaries.push(`Added ${op.path}`);
        break;
      }
      case "delete": {
        const exists = await env.fileExists(op.path);
        if (!exists) {
          throw new Error(`Cannot delete non-existent file: ${op.path}`);
        }
        await env.execCommand(deleteCommandForPath(op.path, env.platform()), 5000);
        summaries.push(`Deleted ${op.path}`);
        break;
      }
      case "update": {
        const numbered = await env.readFile(op.path);
        const rawContent = stripLineNumbers(numbered);
        const updated = applyHunks(rawContent, op.hunks ?? []);

        if (op.newPath !== undefined) {
          await env.writeFile(op.newPath, updated);
          await env.execCommand(deleteCommandForPath(op.path, env.platform()), 5000);
          summaries.push(`Updated and moved ${op.path} -> ${op.newPath}`);
        } else {
          await env.writeFile(op.path, updated);
          summaries.push(`Updated ${op.path}`);
        }
        break;
      }
    }
  }

  return summaries.join("\n");
}

export function createApplyPatchTool(): RegisteredTool {
  return {
    definition: {
      name: "apply_patch",
      description:
        "Apply code changes using the patch format. Supports creating, deleting, and modifying files in a single operation.",
      parameters: {
        type: "object",
        properties: {
          patch: { type: "string", description: "The patch content in v4a format" },
        },
        required: ["patch"],
      },
    },
    executor: async (args, env) => {
      const patch = args.patch as string;
      return applyPatch(patch, env);
    },
  };
}
