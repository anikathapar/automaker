#!/usr/bin/env node
/**
 * Back-compat entry: runs the web app + API (dev) or production build (with --production).
 */
import { spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');
const script = production ? 'start' : 'dev';

const child = spawn('npm', ['run', script], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
