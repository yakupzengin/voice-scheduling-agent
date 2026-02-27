import { Router } from 'express';
import { getDb } from '../db/sqlite';

export const healthRouter = Router();

/**
 * GET /health
 * Returns service status and a liveness indicator.
 * Also verifies the DB connection is available.
 */
healthRouter.get('/', (_req, res) => {
  try {
    // Lightweight DB ping — confirms the SQLite file is accessible
    getDb().prepare('SELECT 1').get();

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      db: 'connected',
    });
  } catch {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      db: 'unavailable',
    });
  }
});
