import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CodexAppServer } from '../../src/server/codex/appServer';
import { JsonRpcClient } from '../../src/server/codex/jsonrpc';

/** A scripted fake of `codex app-server` speaking the newline-delimited JSON-RPC protocol. */
function fakeServer() {
  const fromServer = new PassThrough();
  const toServer = new PassThrough();
  const received: Record<string, unknown>[] = [];
  const send = (msg: object) => fromServer.write(`${JSON.stringify(msg)}\n`);
  let buffer = '';
  toServer.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      const msg = JSON.parse(line) as Record<string, unknown>;
      received.push(msg);
      handle(msg);
      index = buffer.indexOf('\n');
    }
  });
  const handle = (msg: Record<string, unknown>) => {
    switch (msg.method) {
      case 'initialize':
        send({ id: msg.id, result: { userAgent: 'fake', codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos' } });
        break;
      case 'thread/start':
        send({ id: msg.id, result: { thread: { id: 'thread-1' } } });
        break;
      case 'thread/resume': {
        const params = msg.params as { threadId: string };
        if (params.threadId === 'missing') send({ id: msg.id, error: { code: -32000, message: 'not found' } });
        else send({ id: msg.id, result: { thread: { id: params.threadId } } });
        break;
      }
      case 'turn/start': {
        const params = msg.params as { threadId: string; input: { text: string }[] };
        const threadId = params.threadId;
        const prompt = params.input[0]?.text ?? '';
        send({ id: msg.id, result: { turn: { id: 'turn-1', status: 'inProgress' } } });
        // Unrelated thread noise must be ignored.
        send({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'x', itemId: 'm', delta: 'NOPE' } });
        if (prompt.includes('approval')) {
          send({ id: 'srv-1', method: 'item/commandExecution/requestApproval', params: { threadId, itemId: 'cmd' } });
        }
        if (prompt.includes('fail')) {
          send({
            method: 'turn/completed',
            params: { threadId, turn: { id: 'turn-1', status: 'failed', error: { message: 'boom' } } },
          });
          return;
        }
        send({
          method: 'item/started',
          params: { threadId, turnId: 'turn-1', item: { type: 'agentMessage', id: 'msg-1', text: '' } },
        });
        send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: 'Hel' } });
        send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'turn-1', itemId: 'msg-1', delta: 'lo' } });
        send({
          method: 'item/completed',
          params: { threadId, turnId: 'turn-1', item: { type: 'agentMessage', id: 'msg-1', text: 'Hello' } },
        });
        send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn-1', status: 'completed', error: null } } });
        break;
      }
      default:
        break;
    }
  };
  const connect = async () => ({ client: new JsonRpcClient(fromServer, toServer), dispose: () => fromServer.end() });
  return { connect, received };
}

describe('CodexAppServer', () => {
  it('initializes once, starts a thread and streams a turn', async () => {
    const fake = fakeServer();
    const server = new CodexAppServer({ connect: fake.connect, log: () => undefined });
    const threadId = await server.startThread('/repo');
    expect(threadId).toBe('thread-1');

    const deltas: string[] = [];
    const result = await server.runTurn(threadId, 'hi', { onDelta: (d) => deltas.push(d) });
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result).toEqual({ text: 'Hello', status: 'completed', error: null });

    const methods = fake.received.map((m) => m.method);
    expect(methods).toEqual(['initialize', 'initialized', 'thread/start', 'turn/start']);
    const threadStart = fake.received[2]?.params as Record<string, unknown>;
    expect(threadStart).toMatchObject({ cwd: '/repo', sandbox: 'read-only', approvalPolicy: 'never' });
    server.dispose();
  });

  it('reports failed turns', async () => {
    const fake = fakeServer();
    const server = new CodexAppServer({ connect: fake.connect, log: () => undefined });
    const threadId = await server.startThread('/repo');
    const result = await server.runTurn(threadId, 'please fail');
    expect(result.status).toBe('failed');
    expect(result.error).toBe('boom');
    server.dispose();
  });

  it('declines approval requests from the server', async () => {
    const fake = fakeServer();
    const server = new CodexAppServer({ connect: fake.connect, log: () => undefined });
    const threadId = await server.startThread('/repo');
    await server.runTurn(threadId, 'needs approval');
    const response = fake.received.find((m) => m.id === 'srv-1');
    expect(response).toEqual({ id: 'srv-1', result: { decision: 'decline' } });
    server.dispose();
  });

  it('propagates resume failures so callers can start a fresh thread', async () => {
    const fake = fakeServer();
    const server = new CodexAppServer({ connect: fake.connect, log: () => undefined });
    await expect(server.resumeThread('missing', '/repo')).rejects.toThrow('not found');
    await expect(server.resumeThread('thread-9', '/repo')).resolves.toBeUndefined();
    server.dispose();
  });
});
