export interface TimeoutConfig {
  total?: number;
  perStep?: number;
}

export interface AdapterTimeout {
  connect: number;
  request: number;
  streamRead: number;
}
