export interface ArtifactInfo {
  id: string;
  name: string;
  sizeBytes: number;
  storedAt: Date;
  isFileBacked: boolean;
}

export class ArtifactStore {
  private artifacts = new Map<string, { info: ArtifactInfo; data: unknown }>();

  store(artifactId: string, name: string, data: unknown): ArtifactInfo {
    const serialized = JSON.stringify(data);
    const sizeBytes = new TextEncoder().encode(serialized).length;
    const info: ArtifactInfo = {
      id: artifactId,
      name,
      sizeBytes,
      storedAt: new Date(),
      isFileBacked: false, // v1: in-memory only
    };
    this.artifacts.set(artifactId, { info, data });
    return info;
  }

  retrieve(artifactId: string): unknown {
    const entry = this.artifacts.get(artifactId);
    if (!entry) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    return entry.data;
  }

  has(artifactId: string): boolean {
    return this.artifacts.has(artifactId);
  }

  list(): ArtifactInfo[] {
    return [...this.artifacts.values()].map((e) => e.info);
  }

  remove(artifactId: string): void {
    this.artifacts.delete(artifactId);
  }

  clear(): void {
    this.artifacts.clear();
  }
}
