import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('users.ts', () => {
  let dataDir: string;

  beforeEach(() => {
    vi.resetModules();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-users-'));
    process.env.DATA_DIR = dataDir;
  });

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env.DATA_DIR;
  });

  it('createUser then verifyUserPassword succeeds', async () => {
    const { createUser, verifyUserPassword, findUserByUsername } = await import('@/lib/users.js');

    const u = await createUser('alice', 'correct horse battery staple');
    expect(u.username).toBe('alice');
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/i);

    const found = findUserByUsername('alice');
    expect(found?.id).toBe(u.id);

    const verified = await verifyUserPassword('alice', 'correct horse battery staple');
    expect(verified?.id).toBe(u.id);

    const wrong = await verifyUserPassword('alice', 'wrong');
    expect(wrong).toBeNull();
  });

  it('createUser rejects duplicate username', async () => {
    const { createUser } = await import('@/lib/users.js');
    await createUser('bob', 'password-one');
    await expect(createUser('bob', 'password-two')).rejects.toThrow(/already exists/);
  });
});
