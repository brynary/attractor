import { Client } from "./client.js";

let defaultClient: Client | undefined;

export function getDefaultClient(): Client {
  if (!defaultClient) {
    defaultClient = Client.fromEnv();
  }
  return defaultClient;
}

export function setDefaultClient(client: Client): void {
  defaultClient = client;
}
