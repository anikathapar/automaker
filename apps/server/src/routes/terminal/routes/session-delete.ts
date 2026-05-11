/**
 * DELETE /sessions/:id endpoint - Kill a terminal session
 */

import type { Request, Response } from 'express';
import { paramString } from '../../common.js';
import { getTerminalService } from '../../../services/terminal-service.js';

export function createSessionDeleteHandler() {
  return (req: Request, res: Response): void => {
    const terminalService = getTerminalService();
    const id = paramString(req.params.id);
    if (!id) {
      res.status(400).json({ success: false, error: 'id is required' });
      return;
    }
    const killed = terminalService.killSession(id);

    if (!killed) {
      res.status(404).json({
        success: false,
        error: 'Session not found',
      });
      return;
    }

    res.json({
      success: true,
    });
  };
}
