export type DomainEventType =
  | "inventory.created"
  | "inventory.updated"
  | "inventory.deleted"
  | "inventory.adjusted"
  | "order.created"
  | "order.updated"
  | "order.ingested"
  | "order.status_changed"
  | "channel.sync"
  | "channel.status";

export interface DomainEvent {
  type: DomainEventType;
  at: string;
  payload: Record<string, unknown>;
}

import { apiBaseUrl } from "@/lib/runtimeEnv";

type EventHandler = (event: DomainEvent) => void;

class RealtimeClient {
  private source: EventSource | null = null;
  private handlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  connect() {
    if (typeof window === "undefined") return;
    if (this.source && this.source.readyState !== EventSource.CLOSED) return;

    this.intentionalClose = false;
    const url = `${apiBaseUrl()}/api/events`;
    const source = new EventSource(url);
    this.source = source;

    source.onmessage = (msg) => {
      this.dispatchRaw(msg.data);
    };

    const namedTypes: DomainEventType[] = [
      "inventory.created",
      "inventory.updated",
      "inventory.deleted",
      "inventory.adjusted",
      "order.created",
      "order.updated",
      "order.ingested",
      "order.status_changed",
      "channel.sync",
      "channel.status",
    ];

    for (const type of namedTypes) {
      source.addEventListener(type, (msg) => {
        const data = (msg as MessageEvent).data;
        this.dispatchRaw(data);
      });
    }

    source.onerror = () => {
      source.close();
      this.source = null;
      if (this.intentionalClose) return;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 2000);
    };
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }

  subscribe(handler: EventHandler) {
    this.handlers.add(handler);
    this.connect();
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0) this.disconnect();
    };
  }

  private dispatchRaw(raw: string) {
    try {
      const event = JSON.parse(raw) as DomainEvent;
      if (!event?.type) return;
      for (const handler of this.handlers) handler(event);
    } catch {
      // ignore malformed frames
    }
  }
}

export const realtimeClient = new RealtimeClient();
