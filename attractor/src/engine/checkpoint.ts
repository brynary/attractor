import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { Checkpoint } from "../types/checkpoint.js";

/**
 * Save a checkpoint as JSON to the filesystem.
 */
export async function saveCheckpoint(
  checkpoint: Checkpoint,
  path: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(checkpoint, null, 2);
  await writeFile(path, json, "utf-8");
}

/**
 * Load a checkpoint from a JSON file on the filesystem.
 */
export async function loadCheckpoint(path: string): Promise<Checkpoint> {
  const content = await readFile(path, "utf-8");
  const data: unknown = JSON.parse(content);
  if (!isCheckpointShape(data)) {
    throw new Error("Invalid checkpoint data");
  }
  return data;
}

function hasStringProp(obj: object, key: string): boolean {
  return key in obj && typeof (obj as Record<string, unknown>)[key] === "string";
}

function hasObjectProp(obj: object, key: string): boolean {
  const val = (obj as Record<string, unknown>)[key];
  return key in obj && typeof val === "object" && val !== null;
}

function hasArrayProp(obj: object, key: string): boolean {
  return key in obj && Array.isArray((obj as Record<string, unknown>)[key]);
}

function isCheckpointShape(data: unknown): data is Checkpoint {
  if (typeof data !== "object" || data === null) return false;
  return (
    hasStringProp(data, "timestamp") &&
    hasStringProp(data, "currentNode") &&
    hasArrayProp(data, "completedNodes") &&
    hasObjectProp(data, "nodeRetries") &&
    hasObjectProp(data, "contextValues") &&
    hasArrayProp(data, "logs")
  );
}
