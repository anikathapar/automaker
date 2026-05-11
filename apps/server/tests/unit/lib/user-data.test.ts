import { describe, it, expect } from 'vitest';
import { getUserDataDir, resolveCredentialsDataDir } from '@/lib/user-data.js';

describe('user-data.ts', () => {
  it('getUserDataDir joins base and user id', () => {
    expect(getUserDataDir('user-1', '/data/root')).toBe('/data/root/users/user-1');
  });

  it('resolveCredentialsDataDir falls back to base when no user', () => {
    expect(resolveCredentialsDataDir('/data', null)).toBe('/data');
    expect(resolveCredentialsDataDir('/data', undefined)).toBe('/data');
  });

  it('resolveCredentialsDataDir scopes to users subdirectory', () => {
    expect(resolveCredentialsDataDir('/data', 'u-2')).toBe('/data/users/u-2');
  });
});
