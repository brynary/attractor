const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
};

const MAX_IMAGE_SIZE_BYTES: Record<string, number> = {
  openai: 20 * 1024 * 1024,
  anthropic: 5 * 1024 * 1024,
  gemini: 10 * 1024 * 1024,
};

function inferMediaType(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) {
    return "application/octet-stream";
  }
  const ext = path.slice(dot).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function isLocalFilePath(url: string): boolean {
  return url.startsWith("/") || url.startsWith("./") || url.startsWith("~/");
}

function expandTilde(path: string): string {
  if (!path.startsWith("~/")) {
    return path;
  }
  const home = typeof process !== "undefined" ? process.env["HOME"] : undefined;
  if (!home) {
    return path;
  }
  return home + path.slice(1);
}

export interface FileImageResult {
  data: Uint8Array;
  mediaType: string;
}

export function validateImageSize(
  sizeBytes: number,
  provider?: string,
): { valid: boolean; maxSize?: number } {
  if (!provider) {
    return { valid: true };
  }
  const maxSize = MAX_IMAGE_SIZE_BYTES[provider];
  if (maxSize === undefined) {
    return { valid: true };
  }
  return { valid: sizeBytes <= maxSize, maxSize };
}

export async function readImageFile(
  path: string,
  provider?: string,
): Promise<FileImageResult> {
  const resolved = expandTilde(path);
  const file = Bun.file(resolved);
  const sizeBytes = file.size;
  const validation = validateImageSize(sizeBytes, provider);
  if (!validation.valid && validation.maxSize !== undefined) {
    throw new Error(
      `File ${path} size ${sizeBytes} bytes exceeds maximum ${validation.maxSize} bytes for provider ${provider}`,
    );
  }
  const buffer = await file.arrayBuffer();
  return {
    data: new Uint8Array(buffer),
    mediaType: inferMediaType(resolved),
  };
}
