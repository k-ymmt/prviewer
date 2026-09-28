import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { GhRunner } from './gh.js';
import { GhError } from './gh.js';
import {
  createIssueComment,
  createReviewComment,
  DEFAULT_PR_QUERY,
  getCommit,
  getPullRequest,
  listCommits,
  listFiles,
  listPullRequests,
  replyToReviewComment,
  submitReview,
  type RepoRef,
} from './github/prs.js';
import type { CodexService } from './codex/service.js';
import type { StoreRegistry } from './store/prStore.js';
import { viewedOps } from '../shared/viewed.js';
import type {
  AskCodexRequest,
  CommitDetail,
  CreateCodexThreadRequest,
  CreateIssueCommentRequest,
  CreateReviewCommentRequest,
  PRDetail,
  PRListResponse,
  RepoInfo,
  ReplyReviewCommentRequest,
  SetCommitFileViewedRequest,
  SetCommitViewedRequest,
  SetFileViewedRequest,
  SubmitReviewRequest,
} from '../shared/types.js';

export interface AppDeps {
  gh: GhRunner;
  repo: RepoRef & { nameWithOwner: string; url: string };
  viewerLogin: string;
  repoRoot: string;
  stores: StoreRegistry;
  codex: CodexService | null;
  /** Directory holding the built client. When null, only the API is served. */
  clientDir: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function parseNumber(value: string, label: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `Invalid ${label}: ${value}`);
  return n;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new HttpError(400, `${label} is required`);
  return value;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  const { gh, repo, stores } = deps;
  const commitCache = new Map<string, Promise<CommitDetail>>();
  const prDetailCache = new Map<number, { at: number; value: Promise<PRDetail> }>();

  const cachedCommit = (sha: string): Promise<CommitDetail> => {
    let cached = commitCache.get(sha);
    if (!cached) {
      cached = getCommit(gh, repo, sha).catch((error) => {
        commitCache.delete(sha);
        throw error;
      });
      commitCache.set(sha, cached);
    }
    return cached;
  };

  const freshPullRequest = (number: number): Promise<PRDetail> => {
    const cached = prDetailCache.get(number);
    if (cached && Date.now() - cached.at < 10_000) return cached.value;
    const value = getPullRequest(gh, repo, number).catch((error) => {
      prDetailCache.delete(number);
      throw error;
    });
    prDetailCache.set(number, { at: Date.now(), value });
    return value;
  };

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status as 400);
    if (error instanceof GhError) {
      console.error(`[gh] ${error.message}`);
      return c.json({ error: error.message }, 502);
    }
    console.error(error);
    return c.json({ error: error instanceof Error ? error.message : 'Internal error' }, 500);
  });

  // ---- repository ----
  app.get('/api/repo', (c) => {
    const info: RepoInfo = {
      owner: repo.owner,
      name: repo.name,
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      viewerLogin: deps.viewerLogin,
      repoRoot: deps.repoRoot,
      codexAvailable: deps.codex !== null,
    };
    return c.json(info);
  });

  // ---- pull requests ----
  app.get('/api/prs', async (c) => {
    const query = c.req.query('q') ?? DEFAULT_PR_QUERY;
    const items = await listPullRequests(gh, repo, query);
    const response: PRListResponse = { query, items };
    return c.json(response);
  });

  app.get('/api/prs/:number', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    prDetailCache.delete(number);
    return c.json(await freshPullRequest(number));
  });

  app.get('/api/prs/:number/commits', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    return c.json(await listCommits(gh, repo, number));
  });

  app.get('/api/prs/:number/commits/:sha', async (c) => {
    const sha = c.req.param('sha');
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new HttpError(400, 'Invalid commit sha');
    return c.json(await cachedCommit(sha));
  });

  app.get('/api/prs/:number/files', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    return c.json(await listFiles(gh, repo, number));
  });

  // ---- persisted state ----
  app.get('/api/prs/:number/state', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const store = stores.forPR(number);
    const state = await store.load();
    const codexThreads = deps.codex ? await deps.codex.listThreads(store) : state.codexThreads;
    return c.json({ ...state, codexThreads });
  });

  app.put('/api/prs/:number/viewed/commits', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<SetCommitViewedRequest>();
    const sha = requireString(body.sha, 'sha');
    const viewed = await stores.forPR(number).update((s) => {
      const next = viewedOps.setCommitViewed(s.viewed, sha, Boolean(body.viewed));
      return { state: { ...s, viewed: next }, result: next };
    });
    return c.json(viewed);
  });

  app.put('/api/prs/:number/viewed/commit-files', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<SetCommitFileViewedRequest>();
    const sha = requireString(body.sha, 'sha');
    const filePath = requireString(body.path, 'path');
    let allPaths: string[] | undefined;
    if (body.viewed) {
      const commit = await cachedCommit(sha);
      allPaths = commit.files.map((f) => f.path);
    }
    const viewed = await stores.forPR(number).update((s) => {
      const next = viewedOps.setCommitFileViewed(s.viewed, sha, filePath, Boolean(body.viewed), allPaths);
      return { state: { ...s, viewed: next }, result: next };
    });
    return c.json(viewed);
  });

  app.put('/api/prs/:number/viewed/files', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<SetFileViewedRequest>();
    const filePath = requireString(body.path, 'path');
    const blobSha = requireString(body.blobSha, 'blobSha');
    const viewed = await stores.forPR(number).update((s) => {
      const next = viewedOps.setFileViewed(s.viewed, filePath, blobSha, Boolean(body.viewed));
      return { state: { ...s, viewed: next }, result: next };
    });
    return c.json(viewed);
  });

  // ---- GitHub write operations ----
  app.post('/api/prs/:number/comments', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<CreateIssueCommentRequest>();
    await createIssueComment(gh, repo, number, requireString(body.body, 'body'));
    prDetailCache.delete(number);
    return c.json({ ok: true });
  });

  app.post('/api/prs/:number/review-comments', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<CreateReviewCommentRequest>();
    requireString(body.body, 'body');
    requireString(body.path, 'path');
    requireString(body.commitId, 'commitId');
    if (!Number.isInteger(body.line) || body.line <= 0) throw new HttpError(400, 'line must be a positive integer');
    await createReviewComment(gh, repo, number, body);
    prDetailCache.delete(number);
    return c.json({ ok: true });
  });

  app.post('/api/prs/:number/review-comments/reply', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<ReplyReviewCommentRequest>();
    if (!Number.isInteger(body.inReplyTo)) throw new HttpError(400, 'inReplyTo must be a comment id');
    await replyToReviewComment(gh, repo, number, body.inReplyTo, requireString(body.body, 'body'));
    prDetailCache.delete(number);
    return c.json({ ok: true });
  });

  app.post('/api/prs/:number/reviews', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<SubmitReviewRequest>();
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(body.event)) throw new HttpError(400, 'Invalid review event');
    if (body.event !== 'APPROVE' && (typeof body.body !== 'string' || body.body.trim() === '')) {
      throw new HttpError(400, 'A review body is required unless approving');
    }
    await submitReview(gh, repo, number, { event: body.event, body: body.body ?? '' });
    prDetailCache.delete(number);
    return c.json({ ok: true });
  });

  // ---- codex ----
  const requireCodex = (): CodexService => {
    if (!deps.codex) throw new HttpError(503, 'codex CLI is not available on this machine');
    return deps.codex;
  };

  app.get('/api/prs/:number/codex/threads', async (c) => {
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const store = stores.forPR(number);
    const threads = deps.codex ? await deps.codex.listThreads(store) : (await store.load()).codexThreads;
    return c.json(threads);
  });

  app.post('/api/prs/:number/codex/threads', async (c) => {
    const codex = requireCodex();
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<CreateCodexThreadRequest>();
    requireString(body.question, 'question');
    if (!body.selection || typeof body.selection.path !== 'string') throw new HttpError(400, 'selection is required');
    const pr = await freshPullRequest(number);
    const result = await codex.createThread(stores.forPR(number), body, {
      repo: repo.nameWithOwner,
      prNumber: pr.number,
      prTitle: pr.title,
      headSha: pr.headRefOid,
      baseRefName: pr.baseRefName,
      headRefName: pr.headRefName,
    });
    return c.json(result, 201);
  });

  app.post('/api/prs/:number/codex/threads/:threadId/messages', async (c) => {
    const codex = requireCodex();
    const number = parseNumber(c.req.param('number'), 'pull request number');
    const body = await c.req.json<AskCodexRequest>();
    const result = await codex.ask(stores.forPR(number), c.req.param('threadId'), requireString(body.question, 'question'));
    return c.json(result, 201);
  });

  app.delete('/api/prs/:number/codex/threads/:threadId', async (c) => {
    const codex = requireCodex();
    const number = parseNumber(c.req.param('number'), 'pull request number');
    await codex.deleteThread(stores.forPR(number), c.req.param('threadId'));
    return c.json({ ok: true });
  });

  app.get('/api/prs/:number/codex/messages/:messageId/stream', (c) => {
    const codex = requireCodex();
    const events = codex.subscribe(c.req.param('messageId'));
    if (!events) throw new HttpError(404, 'No active codex run for this message');
    return streamSSE(c, async (stream) => {
      for await (const event of events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
        if (event.type === 'done' || event.type === 'error') break;
      }
    });
  });

  // ---- static client ----
  if (deps.clientDir) {
    const clientDir = deps.clientDir;
    app.get('*', async (c) => {
      const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
      if (urlPath.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
      const candidate = path.normalize(path.join(clientDir, urlPath));
      if (candidate.startsWith(clientDir)) {
        try {
          const info = await stat(candidate);
          if (info.isFile()) {
            const body = await readFile(candidate);
            const type = MIME[path.extname(candidate)] ?? 'application/octet-stream';
            const cacheControl = urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
            return c.body(body, 200, { 'Content-Type': type, 'Cache-Control': cacheControl });
          }
        } catch {
          // fall through to SPA index
        }
      }
      const html = await readFile(path.join(clientDir, 'index.html'), 'utf8');
      return c.html(html);
    });
  }

  return app;
}
