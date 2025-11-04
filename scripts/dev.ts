#!/usr/bin/env bun

import { existsSync, mkdirSync } from 'fs';
import { spawn, type Subprocess } from 'bun';

type ManagedCommand = {
  name: string;
  cmd: string[];
};

const bunBinary = Bun.which('bun') ?? 'bun';
const managedProcesses = new Map<string, Subprocess>();
let shuttingDown = false;

if (!existsSync('public/assets')) {
  mkdirSync('public/assets', { recursive: true });
}

const commands: ManagedCommand[] = [
  {
    name: 'tailwind',
    cmd: [
      bunBinary,
      'x',
      'tailwindcss',
      '-i',
      'src/styles/globals.css',
      '-o',
      'public/assets/styles.css',
      '--watch',
    ],
  },
  {
    name: 'frontend',
    cmd: [
      bunBinary,
      'build',
      'src/main.tsx',
      '--outdir',
      'public/assets',
      '--target',
      'browser',
      '--sourcemap=external',
      '--watch',
    ],
  },
  {
    name: 'server',
    cmd: [bunBinary, 'run', '--hot', 'server/index.ts'],
  },
];

const shutdown = async (code: number) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down dev environment…');

  const killers = [...managedProcesses.values()].map(async proc => {
    if (proc.killed) return;
    try {
      proc.kill('SIGTERM');
      await proc.exited;
    } catch {
      proc.kill('SIGKILL');
    }
  });

  await Promise.all(killers);
  process.exit(code);
};

const startCommand = (command: ManagedCommand) => {
  console.log(`Starting ${command.name}…`);
  const processHandle = spawn({
    cmd: command.cmd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  managedProcesses.set(command.name, processHandle);

  processHandle.exited.then(exitCode => {
    if (shuttingDown) return;
    console.error(
      `[${command.name}] exited with code ${exitCode}. Stopping dev server.`
    );
    void shutdown(typeof exitCode === 'number' ? exitCode : 1);
  });
};

commands.forEach(startCommand);

process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

await new Promise(() => {});
