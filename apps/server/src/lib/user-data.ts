/**
 * Per-user paths under DATA_DIR (web login / ALB OIDC identity).
 */

import path from 'path';
import type { Request } from 'express';
import { getWebUserId } from './auth.js';
import { SettingsService } from '../services/settings-service.js';

export type SettingsServiceFactory = (req: Request) => SettingsService;

const defaultDataDir = (): string => process.env.DATA_DIR || './data';

export function getUserDataDir(userId: string, baseDataDir?: string): string {
  return path.join(baseDataDir ?? defaultDataDir(), 'users', userId);
}

/**
 * Where credentials.json should live for this identity.
 * No web user → shared legacy path (baseDataDir).
 */
export function resolveCredentialsDataDir(
  baseDataDir: string,
  webUserId: string | null | undefined
): string {
  if (!webUserId) return baseDataDir;
  return getUserDataDir(webUserId, baseDataDir);
}

export function createSettingsServiceForRequest(
  req: Request,
  baseDataDir: string
): SettingsService {
  const credDir = resolveCredentialsDataDir(baseDataDir, getWebUserId(req));
  if (credDir === baseDataDir) {
    return new SettingsService(baseDataDir);
  }
  return new SettingsService(baseDataDir, { credentialsDataDir: credDir });
}

export function createSettingsServiceFactory(baseDataDir: string): SettingsServiceFactory {
  return (req: Request) => createSettingsServiceForRequest(req, baseDataDir);
}
