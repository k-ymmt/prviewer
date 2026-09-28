import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export type JsonValue = unknown;

export interface JsonRpcNotification {
  method: string;
  params?: JsonValue;
}

export interface JsonRpcServerRequest {
  id: number | string;
  method: string;
  params?: JsonValue;
}

export class JsonRpcError extends Error {
  constructor(
    message: string,
    public readonly code: number | undefined,
    public readonly data: unknown,
  ) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

/**
 * Minimal newline-delimited JSON-RPC client matching the codex app-server wire format
 * (JSON-RPC 2.0 shaped messages without the `jsonrpc` field).
 */
export class JsonRpcClient extends EventEmitter {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable,
  ) {
    super();
    const rl = readline.createInterface({ input });
    rl.on('line', (line) => this.handleLine(line));
    rl.on('close', () => this.handleClose(new Error('codex app-server connection closed')));
  }

  request<T = unknown>(method: string, params?: JsonValue): Promise<T> {
    if (this.closed) return Promise.reject(new Error('codex app-server connection closed'));
    const id = this.nextId++;
    const message = params === undefined ? { id, method } : { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
      this.write(message);
    });
  }

  notify(method: string, params?: JsonValue): void {
    const message = params === undefined ? { method } : { method, params };
    this.write(message);
  }

  respond(id: number | string, result: JsonValue): void {
    this.write({ id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  close(error?: Error): void {
    this.handleClose(error ?? new Error('codex app-server connection closed'));
  }

  private write(message: object): void {
    if (this.closed) return;
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (line.trim() === '') return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      this.emit('protocolError', new Error(`Unparseable line from codex app-server: ${line.slice(0, 200)}`));
      return;
    }
    const hasId = msg.id !== undefined && msg.id !== null;
    const hasMethod = typeof msg.method === 'string';
    if (hasId && !hasMethod) {
      const id = Number(msg.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      if (msg.error !== undefined) {
        const err = msg.error as { code?: number; message?: string; data?: unknown };
        pending.reject(new JsonRpcError(err?.message ?? `${pending.method} failed`, err?.code, err?.data));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }
    if (hasId && hasMethod) {
      const request: JsonRpcServerRequest = { id: msg.id as number | string, method: msg.method as string, params: msg.params };
      this.emit('request', request);
      return;
    }
    if (hasMethod) {
      const notification: JsonRpcNotification = { method: msg.method as string, params: msg.params };
      this.emit('notification', notification);
    }
  }

  private handleClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('close', error);
  }
}
