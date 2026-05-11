/**
 * Spec Regeneration routes - HTTP API for AI-powered spec generation
 */

import { Router } from 'express';
import type { EventEmitter } from '../../lib/events.js';
import { createCreateHandler } from './routes/create.js';
import { createGenerateHandler } from './routes/generate.js';
import { createGenerateFeaturesHandler } from './routes/generate-features.js';
import { createSyncHandler } from './routes/sync.js';
import { createStopHandler } from './routes/stop.js';
import { createStatusHandler } from './routes/status.js';
import type { SettingsServiceFactory } from '../../lib/user-data.js';

export function createSpecRegenerationRoutes(
  events: EventEmitter,
  resolveSettingsService?: SettingsServiceFactory
): Router {
  const router = Router();

  router.post('/create', createCreateHandler(events));
  router.post('/generate', createGenerateHandler(events, resolveSettingsService));
  router.post('/generate-features', createGenerateFeaturesHandler(events, resolveSettingsService));
  router.post('/sync', createSyncHandler(events, resolveSettingsService));
  router.post('/stop', createStopHandler());
  router.get('/status', createStatusHandler());

  return router;
}
