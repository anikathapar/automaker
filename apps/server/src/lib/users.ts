/**
 * File-backed users for web login (`DATA_DIR/users.json`).
 * Passwords are stored as bcrypt hashes only.
 */

import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import * as secureFs from './secure-fs.js';
import { createLogger } from '@automaker/utils';

const logger = createLogger('Users');

const DATA_DIR = process.env.DATA_DIR || './data';
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BCRYPT_ROUNDS = 12;

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

function loadUsers(): UserRecord[] {
  try {
    if (secureFs.existsSync(USERS_FILE)) {
      const data = secureFs.readFileSync(USERS_FILE, 'utf-8') as string;
      const parsed = JSON.parse(data) as unknown;
      if (!Array.isArray(parsed)) {
        logger.warn('users.json is not an array; ignoring');
        return [];
      }
      return parsed as UserRecord[];
    }
  } catch (err) {
    logger.warn('Could not load users.json:', err);
  }
  return [];
}

async function saveUsers(users: UserRecord[]): Promise<void> {
  await secureFs.mkdir(path.dirname(USERS_FILE), { recursive: true });
  await secureFs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

export function findUserByUsername(username: string): UserRecord | null {
  const normalized = username.trim();
  if (!normalized) return null;
  const users = loadUsers();
  return users.find((u) => u.username === normalized) ?? null;
}

export async function verifyUserPassword(
  username: string,
  password: string
): Promise<UserRecord | null> {
  const user = findUserByUsername(username);
  if (!user) return null;
  const match = await bcrypt.compare(password, user.passwordHash);
  return match ? user : null;
}

export async function createUser(username: string, password: string): Promise<UserRecord> {
  const trimmed = username.trim();
  if (!trimmed) {
    throw new Error('Username is required');
  }
  if (typeof password !== 'string') {
    throw new Error('Password is required');
  }
  const users = loadUsers();
  if (users.some((u) => u.username === trimmed)) {
    throw new Error(`User "${trimmed}" already exists`);
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user: UserRecord = {
    id: crypto.randomUUID(),
    username: trimmed,
    passwordHash,
    createdAt: Date.now(),
  };
  users.push(user);
  await saveUsers(users);
  logger.info(`Created user: ${trimmed}`);
  return user;
}
