export interface RequestStartedEvent {
  type: 'request_started';
  id: string;
  method: string;
  path: string;
  timestamp: string;
}

export interface RequestCompletedEvent {
  type: 'request_completed';
  id: string;
  status: number;
  duration_ms: number;
  error?: string;
}

export interface ChunkReceivedEvent {
  type: 'chunk_received';
  id: string;
  chunk_size: number;
}

export type WebSocketEvent = RequestStartedEvent | RequestCompletedEvent | ChunkReceivedEvent;
