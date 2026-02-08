import type { RegisteredTool } from "../types/index.js";
import type { DirEntry } from "../types/index.js";

function formatDirEntry(entry: DirEntry, prefix: string): string {
  const suffix = entry.isDir ? "/" : "";
  const sizeStr = entry.size !== null ? ` (${entry.size} bytes)` : "";
  return `${prefix}${entry.name}${suffix}${sizeStr}`;
}

export function createListDirTool(): RegisteredTool {
  return {
    definition: {
      name: "list_dir",
      description:
        "List the contents of a directory. Returns a tree-like listing with file sizes.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path to the directory to list",
          },
          depth: {
            type: "integer",
            description: "How many levels deep to list (default: 1)",
            default: 1,
          },
        },
        required: ["path"],
      },
    },
    executor: async (args, env) => {
      const path = args.path as string;
      const depth = (args.depth as number | undefined) ?? 1;
      const entries = await env.listDirectory(path, depth);

      if (entries.length === 0) {
        return `${path}/ (empty)`;
      }

      const sorted = [...entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const lines = sorted.map((entry) => formatDirEntry(entry, "  "));
      return `${path}/\n${lines.join("\n")}`;
    },
  };
}

export function createWebSearchTool(): RegisteredTool {
  return {
    definition: {
      name: "web_search",
      description:
        "Search the web for information. Returns search results.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
          max_results: {
            type: "integer",
            description: "Maximum number of results to return (default: 5)",
            default: 5,
          },
        },
        required: ["query"],
      },
    },
    executor: async (args) => {
      const query = args.query as string;
      const maxResults = (args.max_results as number | undefined) ?? 5;
      const encoded = encodeURIComponent(query);
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`);
      if (!response.ok) {
        return `Search failed (status ${response.status}): ${response.statusText}`;
      }

      const html = await response.text();
      const links: string[] = [];
      const regex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(html)) !== null && links.length < maxResults) {
        const link = match[1];
        if (!link) continue;
        links.push(link);
      }

      if (links.length === 0) {
        return "No results found.";
      }
      return links.join("\n");
    },
  };
}

export function createWebFetchTool(): RegisteredTool {
  return {
    definition: {
      name: "web_fetch",
      description:
        "Fetch content from a URL and extract text.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch content from",
          },
        },
        required: ["url"],
      },
    },
    executor: async (args) => {
      const url = args.url as string;
      let response: Response;
      try {
        response = await fetch(url);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return `Fetch failed: ${message}`;
      }
      if (!response.ok) {
        return `Fetch failed (status ${response.status}): ${response.statusText}`;
      }

      const content = await response.text();
      return content.length > 50_000 ? content.slice(0, 50_000) : content;
    },
  };
}

export function createReadManyFilesTool(): RegisteredTool {
  return {
    definition: {
      name: "read_many_files",
      description:
        "Read multiple files at once. Returns concatenated file contents with headers.",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Array of absolute file paths to read",
          },
        },
        required: ["paths"],
      },
    },
    executor: async (args, env) => {
      const paths = args.paths as string[];
      const sections: string[] = [];

      for (const filePath of paths) {
        try {
          const content = await env.readFile(filePath);
          sections.push(`=== ${filePath} ===\n${content}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sections.push(`=== ${filePath} ===\n[ERROR: ${message}]`);
        }
      }

      return sections.join("\n\n");
    },
  };
}
