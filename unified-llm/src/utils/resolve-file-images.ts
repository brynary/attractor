import type { Request } from "../types/request.js";
import type { ContentPart, ImagePart, AudioPart, DocumentPart } from "../types/content-part.js";
import type { Message } from "../types/message.js";
import { isLocalFilePath, readImageFile } from "./file-image.js";

function isFileImagePart(part: ContentPart): part is ImagePart {
  return (
    part.kind === "image" &&
    typeof part.image.url === "string" &&
    isLocalFilePath(part.image.url)
  );
}

function isFileAudioPart(part: ContentPart): part is AudioPart {
  return (
    part.kind === "audio" &&
    typeof part.audio.url === "string" &&
    isLocalFilePath(part.audio.url)
  );
}

function isFileDocumentPart(part: ContentPart): part is DocumentPart {
  return (
    part.kind === "document" &&
    typeof part.document.url === "string" &&
    isLocalFilePath(part.document.url)
  );
}

function isFileContentPart(part: ContentPart): boolean {
  return isFileImagePart(part) || isFileAudioPart(part) || isFileDocumentPart(part);
}

async function resolveContentPart(part: ContentPart, provider?: string): Promise<ContentPart> {
  if (isFileImagePart(part)) {
    const url = part.image.url;
    if (url === undefined) {
      return part;
    }
    const result = await readImageFile(url, provider);
    return {
      kind: "image",
      image: {
        data: result.data,
        mediaType: result.mediaType,
        detail: part.image.detail,
      },
    };
  }

  if (isFileAudioPart(part)) {
    const url = part.audio.url;
    if (url === undefined) {
      return part;
    }
    const result = await readImageFile(url, provider);
    return {
      kind: "audio",
      audio: {
        data: result.data,
        mediaType: result.mediaType,
      },
    };
  }

  if (isFileDocumentPart(part)) {
    const url = part.document.url;
    if (url === undefined) {
      return part;
    }
    const result = await readImageFile(url, provider);
    return {
      kind: "document",
      document: {
        data: result.data,
        mediaType: result.mediaType,
        fileName: part.document.fileName,
      },
    };
  }

  return part;
}

async function resolveMessage(message: Message, provider?: string): Promise<Message> {
  const hasFileContent = message.content.some(isFileContentPart);
  if (!hasFileContent) {
    return message;
  }
  const resolvedContent = await Promise.all(
    message.content.map(part => resolveContentPart(part, provider)),
  );
  return { ...message, content: resolvedContent };
}

/**
 * Pre-processes a Request, resolving any image, audio, or document parts with local file paths
 * (starting with /, ./, or ~/) into inline Uint8Array data.
 * Returns the original request if no file content is found.
 * Validates image sizes against provider limits if provider is specified.
 */
export async function resolveFileImages(request: Request): Promise<Request> {
  const hasAnyFileContent = request.messages.some((msg) =>
    msg.content.some(isFileContentPart),
  );
  if (!hasAnyFileContent) {
    return request;
  }
  const resolvedMessages = await Promise.all(
    request.messages.map(msg => resolveMessage(msg, request.provider)),
  );
  return { ...request, messages: resolvedMessages };
}
