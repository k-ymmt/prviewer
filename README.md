# prviewer

A local web UI for reviewing GitHub pull requests of the repository you are standing in.

- **PR list** filtered by default to pull requests awaiting your review, with presets and free-form GitHub search syntax.
- **Conversation tab** with the description, comments and reviews (rendered by GitHub), plus comment / review submission.
- **Commits tab** with a commit list on the left and the selected commit (message, comments, per-file diffs) on the right.
- **Files changed tab** with unified/split diffs, syntax highlighting, GitHub review threads inline and a file navigator.
- **Viewed tracking** for commits, files inside a commit, and PR-level files. A commit becomes viewed automatically when all its files are viewed. PR-level "viewed" marks remember the file's blob SHA and are dropped when the file changes again (like GitHub). Everything is persisted under `~/.local/share/prviewer/`, so it survives reloads and server restarts.
- **Ask Codex** about any selected line range of a diff. Answers stream in, threads support follow-up questions, and the conversations are persisted next to the viewed state.

All GitHub access goes through the [GitHub CLI](https://cli.github.com/) (`gh`), so no extra tokens are needed. Codex access uses the local `codex app-server` in a read-only sandbox.

## Requirements

- Node.js 22 or newer
- `gh` (authenticated: `gh auth login`)
- `codex` CLI (optional; "Ask Codex" is disabled when it is not installed)

## Install

```bash
npm install
npm run build
npm link        # makes the `prviewer` command available globally
```

## Usage

```bash
cd path/to/your/repo
prviewer .
```

The server picks the repository from the git remote of the given directory (default: the current directory), starts on port 4380 and opens your browser.

```
Usage: prviewer [path] [options]

Options:
  -p, --port <number>   Port to listen on (default: $PRVIEWER_PORT or 4380; 0 picks a free port)
      --host <host>     Host to bind (default: 127.0.0.1)
      --no-open         Do not open the browser automatically
  -h, --help            Show this help
```

State is stored in `$PRVIEWER_DATA_DIR`, `$XDG_DATA_HOME/prviewer` or `~/.local/share/prviewer/<owner>/<repo>/pr-<number>.json`.

### Working with diffs

- Drag over line numbers to select multiple lines, then click the `+` button on the last selected line.
- Choose **Ask codex** to start a Codex thread about those lines, or **Comment on GitHub** to leave a review comment (Files changed tab only).
- Codex runs with the repository as its working directory in a read-only sandbox. The prompt carries the selected lines and surrounding hunk, and tells Codex which revision the diff belongs to.

## Development

```bash
npm run dev          # API server on :4321 (tsx watch) + Vite dev server on :5173 with /api proxied
npm run typecheck
npm test
npm run build
```

The layout:

```
src/cli        command-line entry point
src/server     Hono API, gh wrappers, JSON state store, codex app-server client
src/client     React + Primer UI (Vite)
src/shared     types and pure logic shared by both sides
tests          vitest suites (server: node, client: jsdom)
```
