#!/usr/bin/env node
import('../dist/server/cli/index.js').then((m) => m.main(process.argv.slice(2))).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
