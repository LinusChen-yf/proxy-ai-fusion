#!/usr/bin/env bun

import { existsSync } from 'fs';
import { fileURLToPath } from 'node:url';

const [, , rawArg] = process.argv;

const helpMessage = `Proxy AI Fusion

Usage:
  bunx proxy-ai-fusion [command]

Commands:
  start   Launch the proxy server (default)
  help    Show this help message
`;

const startServer = async (): Promise<void> => {
  const distEntry = new URL('../dist/index.js', import.meta.url);
  const sourceEntry = new URL('../server/index.ts', import.meta.url);
  const distPath = fileURLToPath(distEntry);

  if (existsSync(distPath)) {
    await import(distEntry.href);
    return;
  }

  console.warn('dist/index.js not found. Falling back to server/index.ts');
  await import(sourceEntry.href);
};

const normalized = (rawArg ?? 'start').toLowerCase();

switch (normalized) {
  case 'start':
    await startServer();
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(helpMessage);
    break;
  default:
    console.error(`Unknown command: ${rawArg}\n`);
    console.log(helpMessage);
    process.exit(1);
}
