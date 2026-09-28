# prviewer

Local GitHub pull request viewer: TypeScript, React 19, Vite, Primer React, Hono. GitHub data comes from the `gh` CLI; "Ask Codex" talks to `codex app-server` over stdio JSON-RPC.

## Commands

- `npm run dev` — API server (tsx watch, port 4321) + Vite dev server (port 5173, `/api` proxied)
- `npm run build` — Vite client build to `dist/client`, server `tsc` build to `dist/server`
- `npm run typecheck` — both tsconfig projects
- `npm test` — vitest (server project in node, client project in jsdom)
- `node bin/prviewer.js --no-open <repo>` — run the built CLI

## Layout

- `src/cli/index.ts` — argument parsing, repo resolution, server start, browser open
- `src/server/app.ts` — all HTTP routes (`createApp(deps)`; dependencies are injected so tests use fakes)
- `src/server/gh.ts` — `gh` runner; `src/server/github/prs.ts` — PR list, GraphQL detail, commits, files, write ops
- `src/server/store/` — per-PR JSON state under the data dir (viewed marks + codex threads); atomic writes, serialized updates
- `src/server/codex/` — JSON-RPC client, app-server lifecycle, prompt builder, streaming service
- `src/shared/` — DTO types and `viewedOps` (pure; used by server store and client cache)
- `src/client/` — React app. `pages/` = routes, `components/FileDiff.tsx` wraps `@git-diff-view/react`
- `tests/server`, `tests/client` — vitest suites

## Conventions

- Keep server modules free of DOM code and client modules free of node imports; shared logic goes in `src/shared`.
- New API routes: add DTO types in `src/shared/types.ts`, the route in `src/server/app.ts`, a hook in `src/client/api/hooks.ts`, and a test in `tests/server/app.test.ts`.
- GitHub writes go through `gh api --input -` with a JSON body (never shell interpolation).
- Codex is always started with `sandbox: read-only`, `approvalPolicy: never`; any approval request is declined.
- Run `npm run typecheck && npm test` before committing.
