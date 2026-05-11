/**
 * POST /api/settings/project - Get project-specific settings
 *
 * Retrieves settings overrides for a specific project. Uses POST because
 * projectPath may contain special characters that don't work well in URLs.
 *
 * Request body: `{ projectPath: string }`
 * Response: `{ "success": true, "settings": ProjectSettings }`
 */

import type { Request, Response } from 'express';
import type { SettingsServiceFactory } from '../../../lib/user-data.js';
import { getErrorMessage, logError } from '../common.js';

/**
 * Create handler factory for POST /api/settings/project
 *
 * @param resolveSettingsService - Per-request SettingsService (global settings + scoped credentials)
 * @returns Express request handler
 */
export function createGetProjectHandler(resolveSettingsService: SettingsServiceFactory) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const settingsService = resolveSettingsService(req);
      const { projectPath } = req.body as { projectPath?: string };

      if (!projectPath || typeof projectPath !== 'string') {
        res.status(400).json({
          success: false,
          error: 'projectPath is required',
        });
        return;
      }

      const settings = await settingsService.getProjectSettings(projectPath);

      res.json({
        success: true,
        settings,
      });
    } catch (error) {
      logError(error, 'Get project settings failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
