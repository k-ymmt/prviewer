import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { serve } from '@hono/node-server';
import open from 'open';
import { createApp } from '../server/app.js';
import { CodexAppServer } from '../server/codex/appServer.js';
import { CodexService } from '../server/codex/service.js';
import { createGhRunner } from '../server/gh.js';
import { findGitRoot, resolveRepo, resolveViewerLogin } from '../server/github/repo.js';
import { resolveDataDir } from '../server/store/paths.js';
import { createFileStoreRegistry } from '../server/store/prStore.js';

const HELP = `Usage: prviewer [path] [options]

Opens a local web UI for reviewing GitHub pull requests of the repository at <path> (default: current directory).

Options:
  -p, --port <number>   Port to listen on (default: $PRVIEWER_PORT or 4380; 0 picks a free port)
      --host <host>     Host to bind (default: 127.0.0.1)
      --no-open         Do not open the browser automatically
  -h, --help            Show this help
`;

function commandExists(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, args, (error) => resolve(!error));
  });
}

function resolveClientDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(here, '../../client'), path.resolve(here, '../../../dist/client')];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      open: { type: 'boolean', default: true },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    allowNegative: true,
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const targetDir = path.resolve(positionals[0] ?? '.');
  if (!existsSync(targetDir)) throw new Error(`Directory not found: ${targetDir}`);
  const repoRoot = await findGitRoot(targetDir);

  if (!(await commandExists('gh', ['--version']))) {
    throw new Error('The GitHub CLI (`gh`) is required but was not found in PATH.');
  }
  const gh = createGhRunner(repoRoot);
  const [repo, viewerLogin] = await Promise.all([resolveRepo(gh), resolveViewerLogin(gh)]);

  const codexAvailable = await commandExists('codex', ['--version']);
  const codexServer = codexAvailable ? new CodexAppServer({ log: (m) => console.error(`[codex] ${m}`) }) : null;
  const codex = codexServer ? new CodexService(codexServer, repoRoot) : null;
  if (!codexAvailable) {
    console.error('prviewer: `codex` CLI not found; "Ask Codex" will be disabled.');
  }

  const dataDir = resolveDataDir();
  const stores = createFileStoreRegistry(dataDir, repo.owner, repo.name);
  const clientDir = resolveClientDir();
  if (!clientDir) {
    console.error('prviewer: built client not found; serving API only (run `npm run build`).');
  }

  const app = createApp({ gh, repo, viewerLogin, repoRoot, stores, codex, clientDir });

  const port = Number.parseInt(values.port ?? process.env.PRVIEWER_PORT ?? '4380', 10);
  if (!Number.isFinite(port) || port < 0) throw new Error(`Invalid port: ${values.port}`);
  const host = values.host ?? '127.0.0.1';

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    const url = `http://${host}:${info.port}/`;
    console.log(`prviewer: ${repo.nameWithOwner} (${repoRoot})`);
    console.log(`prviewer: listening on ${url}`);
    console.log(`prviewer: state directory ${dataDir}`);
    if (values.open) {
      open(url).catch((error: Error) => console.error(`prviewer: could not open browser: ${error.message}`));
    }
  });

  const shutdown = () => {
    codexServer?.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
