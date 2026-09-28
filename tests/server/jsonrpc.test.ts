import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { JsonRpcClient, JsonRpcError, type JsonRpcNotification, type JsonRpcServerRequest } from '../../src/server/codex/jsonrpc';

function setup() {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const written: string[] = [];
  toServer.on('data', (chunk: Buffer) => written.push(...chunk.toString().split('\n').filter(Boolean)));
  const client = new JsonRpcClient(fromServer, toServer);
  const serverSends = (msg: object) => fromServer.write(`${JSON.stringify(msg)}\n`);
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { client, written, serverSends, flush, fromServer };
}

describe('JsonRpcClient', () => {
  it('sends requests without a jsonrpc field and resolves matching responses', async () => {
    const { client, written, serverSends, flush } = setup();
    const pending = client.request<{ ok: boolean }>('initialize', { a: 1 });
    await flush();
    expect(JSON.parse(written[0] ?? '')).toEqual({ id: 1, method: 'initialize', params: { a: 1 } });
    serverSends({ id: 1, result: { ok: true } });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('rejects with JsonRpcError on error responses', async () => {
    const { client, serverSends } = setup();
    const pending = client.request('thread/resume', { threadId: 'x' });
    serverSends({ id: 1, error: { code: -32000, message: 'thread not found' } });
    await expect(pending).rejects.toBeInstanceOf(JsonRpcError);
    await expect(pending).rejects.toMatchObject({ message: 'thread not found', code: -32000 });
  });

  it('emits notifications and server requests separately', async () => {
    const { client, serverSends, flush } = setup();
    const notifications: JsonRpcNotification[] = [];
    const requests: JsonRpcServerRequest[] = [];
    client.on('notification', (n: JsonRpcNotification) => notifications.push(n));
    client.on('request', (r: JsonRpcServerRequest) => requests.push(r));
    serverSends({ method: 'turn/started', params: { threadId: 't' } });
    serverSends({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: {} });
    serverSends({ garbage: true });
    await flush();
    expect(notifications).toEqual([{ method: 'turn/started', params: { threadId: 't' } }]);
    expect(requests).toEqual([{ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: {} }]);
  });

  it('writes responses to server requests', async () => {
    const { client, written, flush } = setup();
    client.respond('srv-1', { decision: 'decline' });
    client.notify('initialized');
    await flush();
    expect(JSON.parse(written[0] ?? '')).toEqual({ id: 'srv-1', result: { decision: 'decline' } });
    expect(JSON.parse(written[1] ?? '')).toEqual({ method: 'initialized' });
  });

  it('rejects pending requests when the stream closes', async () => {
    const { client, fromServer } = setup();
    const pending = client.request('turn/start', {});
    fromServer.end();
    await expect(pending).rejects.toThrow(/closed/);
    await expect(client.request('x')).rejects.toThrow(/closed/);
  });
});
