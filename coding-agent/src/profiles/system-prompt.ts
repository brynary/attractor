import type { ExecutionEnvironment } from "../types/index.js";
import type { EnvironmentContextOptions } from "../types/provider-profile.js";

const PROJECT_DOCS_BUDGET = 32 * 1024;

export function buildEnvironmentContext(
  env: ExecutionEnvironment,
  options?: EnvironmentContextOptions,
): string {
  const date = new Date().toISOString().split("T")[0];
  const lines = [
    "<environment>",
    `Working directory: ${env.workingDirectory()}`,
    `Is git repository: ${options?.isGitRepo ? "true" : "false"}`,
    `Git branch: ${options?.gitBranch || "(none)"}`,
    `Platform: ${env.platform()}`,
    `OS version: ${env.osVersion()}`,
    `Today's date: ${date}`,
  ];
  if (options?.modelDisplayName) {
    lines.push(`Model: ${options.modelDisplayName}`);
  }
  if (options?.knowledgeCutoff) {
    lines.push(`Knowledge cutoff: ${options.knowledgeCutoff}`);
  }
  lines.push("</environment>");

  // Git context snapshot (section 6.4) -- separate from environment block
  if (options?.modifiedCount !== undefined) {
    lines.push(`Modified files: ${options.modifiedCount}`);
  }
  if (options?.untrackedCount !== undefined) {
    lines.push(`Untracked files: ${options.untrackedCount}`);
  }
  if (options?.recentCommits && options.recentCommits.length > 0) {
    lines.push("Recent commits:");
    for (const commit of options.recentCommits) {
      lines.push(`  ${commit}`);
    }
  }
  return lines.join("\n");
}

export async function discoverProjectDocs(
  env: ExecutionEnvironment,
  providerFileNames: string[],
  gitRoot?: string,
): Promise<string> {
  const cwd = env.workingDirectory();
  const candidates = ["AGENTS.md", ...providerFileNames];

  // Build list of directories to search: from gitRoot down to cwd
  const searchDirs = buildSearchDirs(gitRoot, cwd);

  const parts: string[] = [];
  let totalLength = 0;

  for (const dir of searchDirs) {
    for (const name of candidates) {
      const path = dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
      const exists = await env.fileExists(path);
      if (!exists) continue;

      const numbered = await env.readFile(path);
      // Strip line numbers from env.readFile output
      const content = numbered
        .split("\n")
        .map((line) => {
          const pipeIndex = line.indexOf(" | ");
          return pipeIndex >= 0 ? line.slice(pipeIndex + 3) : line;
        })
        .join("\n");

      if (totalLength + content.length > PROJECT_DOCS_BUDGET) {
        const remaining = PROJECT_DOCS_BUDGET - totalLength;
        if (remaining > 0) {
          parts.push(content.slice(0, remaining));
          parts.push("[Project instructions truncated at 32KB]");
        }
        return parts.join("\n\n");
      }

      parts.push(content);
      totalLength += content.length;
    }
  }

  return parts.join("\n\n");
}

function buildSearchDirs(gitRoot: string | undefined, cwd: string): string[] {
  if (!gitRoot || gitRoot === cwd) return [cwd];

  // Normalize: remove trailing slash
  const root = gitRoot.endsWith("/") ? gitRoot.slice(0, -1) : gitRoot;
  const target = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;

  if (!target.startsWith(root)) return [cwd];

  // Build directories from root down to cwd
  const relative = target.slice(root.length);
  const segments = relative.split("/").filter(Boolean);
  const dirs = [root];
  let current = root;
  for (const seg of segments) {
    current = `${current}/${seg}`;
    dirs.push(current);
  }
  return dirs;
}

export function buildSystemPrompt(
  basePrompt: string,
  envContext: string,
  toolDescriptions: string,
  projectDocs: string,
  userInstructions?: string,
): string {
  const sections = [basePrompt, envContext, toolDescriptions, projectDocs];
  if (userInstructions) {
    sections.push(userInstructions);
  }
  return sections.filter((s) => s.length > 0).join("\n\n");
}
