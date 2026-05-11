/**
 * Backlog Plan routes - HTTP API for AI-assisted backlog modification
 */

import { Router } from 'express';
import type { EventEmitter } from '../../lib/events.js';
import { validatePathParams } from '../../middleware/validate-paths.js';
import { createGenerateHandler } from './routes/generate.js';
import { createStopHandler } from './routes/stop.js';
import { createStatusHandler } from './routes/status.js';
import { createApplyHandler } from './routes/apply.js';
import { createClearHandler } from './routes/clear.js';
import type { SettingsServiceFactory } from '../../lib/user-data.js';

export function createBacklogPlanRoutes(
  events: EventEmitter,
  resolveSettingsService?: SettingsServiceFactory
): Router {
  const router = Router();

  router.post(
    '/generate',
    validatePathParams('projectPath'),
    createGenerateHandler(events, resolveSettingsService)
  );
  router.post('/stop', createStopHandler());
  router.get('/status', validatePathParams('projectPath'), createStatusHandler());
  router.post(
    '/apply',
    validatePathParams('projectPath'),
    createApplyHandler(resolveSettingsService)
  );
  router.post('/clear', validatePathParams('projectPath'), createClearHandler());

  return router;
}
