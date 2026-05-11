/**
 * Enhance prompt routes - HTTP API for AI-powered text enhancement
 *
 * Provides endpoints for enhancing user input text using Claude AI
 * with different enhancement modes (improve, expand, simplify, etc.)
 */

import { Router } from 'express';
import type { SettingsServiceFactory } from '../../lib/user-data.js';
import { createEnhanceHandler } from './routes/enhance.js';

/**
 * Create the enhance-prompt router
 *
 * @param resolveSettingsService - Per-request settings (scoped credentials when logged in)
 * @returns Express router with enhance-prompt endpoints
 */
export function createEnhancePromptRoutes(resolveSettingsService?: SettingsServiceFactory): Router {
  const router = Router();

  router.post('/', createEnhanceHandler(resolveSettingsService));

  return router;
}
