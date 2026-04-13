#!/usr/bin/env node
/**
 * Production: run built API server, wait for health, then serve the Vite-built UI.
 */
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webPort = process.env.AUTOMAKER_WEB_PORT || '3007';
const serverPort = process.env.PORT || process.env.AUTOMAKER_SERVER_PORT || '3008';
const hostname = process.env.VITE_HOSTNAME || 'localhost';
const dataDir = process.env.DATA_DIR || join(root, 'data');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const corsOrigins = `http://localhost:${webPort},http://127.0.0.1:${webPort}`;
const corsExtra =
  hostname !== 'localhost' && hostname !== '127.0.0.1' ? `,http://${hostname}:${webPort}` : '';

const serverEnv = {
  ...process.env,
  PORT: String(serverPort),
  DATA_DIR: dataDir,
  CORS_ORIGIN: `${corsOrigins}${corsExtra}`,
};

const server = spawn(npmCmd, ['run', 'start', '--workspace=apps/server'], {
  cwd: root,
  stdio: 'inherit',
  shell: isWin,
  env: serverEnv,
});

function shutdown(code = 0) {
  try {
    server.kill('SIGTERM');
  } catch {
    /* ignore */
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

async function waitForHealth() {
  const url = `http://127.0.0.1:${serverPort}/api/health`;
  for (let i = 0; i < 45; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Server failed to become healthy');
}

try {
  await waitForHealth();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  shutdown(1);
}

const previewEnv = {
  ...process.env,
  VITE_SERVER_URL: `http://${hostname}:${serverPort}`,
};

const ui = spawn(
  npmCmd,
  ['run', 'preview', '--workspace=apps/ui', '--', '--host', '0.0.0.0', '--port', String(webPort)],
  {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    env: previewEnv,
  }
);

ui.on('exit', (code) => {
  shutdown(code ?? 0);
});
