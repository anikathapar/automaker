/**
 * GET /api/settings/global - Retrieve global user settings
 *
 * Returns the complete GlobalSettings object with all user preferences,
 * keyboard shortcuts, AI profiles, and project history.
 *
 * Response: `{ "success": true, "settings": GlobalSettings }`
 */

import type { Request, Response } from 'express';
import type { SettingsServiceFactory } from '../../../lib/user-data.js';
import { getErrorMessage, logError } from '../common.js';

/**
 * Create handler factory for GET /api/settings/global
 *
 * @param resolveSettingsService - Per-request SettingsService (global settings + scoped credentials)
 * @returns Express request handler
 */
export function createGetGlobalHandler(resolveSettingsService: SettingsServiceFactory) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const settingsService = resolveSettingsService(req);
      const settings = await settingsService.getGlobalSettings();

      res.json({
        success: true,
        settings,
      });
    } catch (error) {
      logError(error, 'Get global settings failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
