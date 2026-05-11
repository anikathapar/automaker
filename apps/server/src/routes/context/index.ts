/**
 * Context routes - HTTP API for context file operations
 *
 * Provides endpoints for managing context files including
 * AI-powered image description generation.
 */

import { Router } from 'express';
import { createDescribeImageHandler } from './routes/describe-image.js';
import { createDescribeFileHandler } from './routes/describe-file.js';
import type { SettingsServiceFactory } from '../../lib/user-data.js';

/**
 * Create the context router
 *
 * @param resolveSettingsService - Per-request settings (scoped credentials when logged in)
 * @returns Express router with context endpoints
 */
export function createContextRoutes(resolveSettingsService?: SettingsServiceFactory): Router {
  const router = Router();

  router.post('/describe-image', createDescribeImageHandler(resolveSettingsService));
  router.post('/describe-file', createDescribeFileHandler(resolveSettingsService));

  return router;
}
