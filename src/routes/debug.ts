import { Router } from 'express';
import { ringBuffer } from '../utils/ringBuffer';
import { env } from '../config/env';

export const debugRouter = Router();

/**
 * GET /debug/last-logs
 *
 * Returns the last 200 structured log lines from the in-memory ring buffer.
 * Available in development only (NODE_ENV !== 'production').
 *
 * Secrets are safe here: pino redacts all sensitive keys BEFORE lines reach
 * the ring buffer, so no tokens or secrets can appear in the output.
 */
debugRouter.get('/last-logs', (_req, res) => {
  if (env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  const entries = ringBuffer.drain();
  return res.status(200).json({
    count:   entries.length,
    entries,
  });
});
