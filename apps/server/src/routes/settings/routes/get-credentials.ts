/**
 * GET /api/settings/credentials - Get API key status (masked for security)
 *
 * Returns masked credentials showing which providers have keys configured.
 * Each provider shows: `{ configured: boolean, masked: string }`
 * Masked shows first 4 and last 4 characters for verification.
 *
 * Response: `{ "success": true, "credentials": { anthropic, google, openai } }`
 */

import type { Request, Response } from 'express';
import type { SettingsServiceFactory } from '../../../lib/user-data.js';
import { getErrorMessage, logError } from '../common.js';

/**
 * Create handler factory for GET /api/settings/credentials
 *
 * @param resolveSettingsService - Per-request SettingsService (global settings + scoped credentials)
 * @returns Express request handler
 */
export function createGetCredentialsHandler(resolveSettingsService: SettingsServiceFactory) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const settingsService = resolveSettingsService(req);
      const credentials = await settingsService.getMaskedCredentials();

      res.json({
        success: true,
        credentials,
      });
    } catch (error) {
      logError(error, 'Get credentials failed');
      res.status(500).json({ success: false, error: getErrorMessage(error) });
    }
  };
}
